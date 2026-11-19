package migrations

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"time"
)

// SQLFiles embeds all SQL migration files in this directory.
//
//go:embed *.sql
var SQLFiles embed.FS

// Migration represents a single up/down SQL migration step.
type Migration struct {
	Version int
	Name    string
	UpSQL   string
	DownSQL string
}

// Migrator manages and executes database migrations atomically.
type Migrator struct {
	db     *sql.DB
	fs     fs.FS
	logger *slog.Logger
}

// NewMigrator initializes a Migrator for the given database connection.
func NewMigrator(db *sql.DB, logger *slog.Logger) *Migrator {
	if logger == nil {
		logger = slog.Default()
	}
	return &Migrator{
		db:     db,
		fs:     SQLFiles,
		logger: logger,
	}
}

// WithFS returns the migrator configured with a custom file system (useful for testing).
func (m *Migrator) WithFS(f fs.FS) *Migrator {
	m.fs = f
	return m
}

// ensureSchemaTable creates the schema_migrations tracking table if it does not exist.
func (m *Migrator) ensureSchemaTable(ctx context.Context) error {
	query := `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version BIGINT PRIMARY KEY,
			dirty BOOLEAN NOT NULL DEFAULT FALSE,
			applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
		);
	`
	_, err := m.db.ExecContext(ctx, query)
	if err != nil {
		return fmt.Errorf("failed to create schema_migrations table: %w", err)
	}
	return nil
}

// GetVersion returns the current applied migration version and dirty status.
func (m *Migrator) GetVersion(ctx context.Context) (int, bool, error) {
	if err := m.ensureSchemaTable(ctx); err != nil {
		return 0, false, err
	}

	query := `SELECT version, dirty FROM schema_migrations ORDER BY version DESC LIMIT 1;`
	row := m.db.QueryRowContext(ctx, query)

	var version int
	var dirty bool
	err := row.Scan(&version, &dirty)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("failed to read schema version: %w", err)
	}
	return version, dirty, nil
}

// LoadMigrations parses and returns all embedded migrations ordered by version number.
func (m *Migrator) LoadMigrations() ([]Migration, error) {
	entries, err := fs.ReadDir(m.fs, ".")
	if err != nil {
		return nil, fmt.Errorf("failed to read embedded migration files: %w", err)
	}

	upFiles := make(map[int]string)
	downFiles := make(map[int]string)
	names := make(map[int]string)

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}

		parts := strings.Split(entry.Name(), "_")
		if len(parts) < 2 {
			continue
		}

		ver, err := strconv.Atoi(parts[0])
		if err != nil {
			continue
		}

		data, err := fs.ReadFile(m.fs, entry.Name())
		if err != nil {
			return nil, fmt.Errorf("failed to read embedded file %s: %w", entry.Name(), err)
		}

		if strings.HasSuffix(entry.Name(), ".up.sql") {
			upFiles[ver] = string(data)
			name := strings.TrimSuffix(strings.Join(parts[1:], "_"), ".up.sql")
			names[ver] = name
		} else if strings.HasSuffix(entry.Name(), ".down.sql") {
			downFiles[ver] = string(data)
		}
	}

	var versions []int
	for v := range upFiles {
		versions = append(versions, v)
	}
	sort.Ints(versions)

	var migrations []Migration
	for _, v := range versions {
		migrations = append(migrations, Migration{
			Version: v,
			Name:    names[v],
			UpSQL:   upFiles[v],
			DownSQL: downFiles[v],
		})
	}

	return migrations, nil
}

// RunPending applies all pending migrations in ascending version order atomically.
func (m *Migrator) RunPending(ctx context.Context) error {
	if err := m.ensureSchemaTable(ctx); err != nil {
		return err
	}

	currentVersion, dirty, err := m.GetVersion(ctx)
	if err != nil {
		return err
	}
	if dirty {
		return fmt.Errorf("database is in dirty state at version %d; manual intervention required", currentVersion)
	}

	migrations, err := m.LoadMigrations()
	if err != nil {
		return err
	}

	count := 0
	for _, mig := range migrations {
		if mig.Version <= currentVersion {
			continue
		}

		m.logger.Info("Applying database migration", "version", mig.Version, "name", mig.Name)

		// Record dirty state prior to executing migration DDL
		_, _ = m.db.ExecContext(ctx, "INSERT INTO schema_migrations (version, dirty, applied_at) VALUES ($1, true, $2) ON CONFLICT (version) DO UPDATE SET dirty = true, applied_at = $2;", mig.Version, time.Now())

		tx, err := m.db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("failed to start migration transaction for version %d: %w", mig.Version, err)
		}

		if _, err := tx.ExecContext(ctx, mig.UpSQL); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("failed to apply migration %d (%s): %w", mig.Version, mig.Name, err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("failed to commit migration %d: %w", mig.Version, err)
		}

		// Mark clean state upon successful commit
		if _, err := m.db.ExecContext(ctx, "UPDATE schema_migrations SET dirty = false WHERE version = $1;", mig.Version); err != nil {
			return fmt.Errorf("failed to update schema_migrations clean state: %w", err)
		}
		count++
	}

	if count > 0 {
		m.logger.Info("Database migrations applied successfully", "count", count)
	} else {
		m.logger.Debug("Database schema is already up to date")
	}

	return nil
}

// RollbackLatest reverts the latest applied migration using its down SQL.
func (m *Migrator) RollbackLatest(ctx context.Context) error {
	if err := m.ensureSchemaTable(ctx); err != nil {
		return err
	}

	currentVersion, dirty, err := m.GetVersion(ctx)
	if err != nil {
		return err
	}
	if currentVersion == 0 {
		m.logger.Info("No migrations to rollback (schema version is 0)")
		return nil
	}
	if dirty {
		return fmt.Errorf("database is in dirty state at version %d; rollback aborted", currentVersion)
	}

	migrations, err := m.LoadMigrations()
	if err != nil {
		return err
	}

	var target *Migration
	for i := range migrations {
		if migrations[i].Version == currentVersion {
			target = &migrations[i]
			break
		}
	}

	if target == nil {
		return fmt.Errorf("migration definition not found for version %d", currentVersion)
	}
	if target.DownSQL == "" {
		return fmt.Errorf("migration %d does not define a down rollback script", target.Version)
	}

	m.logger.Info("Rolling back database migration", "version", target.Version, "name", target.Name)

	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to start rollback transaction: %w", err)
	}

	if _, err := tx.ExecContext(ctx, target.DownSQL); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("failed to execute rollback SQL for version %d: %w", target.Version, err)
	}

	if _, err := tx.ExecContext(ctx, "DELETE FROM schema_migrations WHERE version = $1;", target.Version); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("failed to delete version %d from schema_migrations: %w", target.Version, err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit rollback transaction: %w", err)
	}

	m.logger.Info("Migration rolled back successfully", "version", target.Version)
	return nil
}

// Up is a convenience alias for RunPending.
func (m *Migrator) Up(ctx context.Context) error {
	return m.RunPending(ctx)
}

// Down is a convenience alias for RollbackLatest.
func (m *Migrator) Down(ctx context.Context) error {
	return m.RollbackLatest(ctx)
}
