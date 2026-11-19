package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	_ "github.com/lib/pq"
	"github.com/soroban-anchor-gate/relay/internal/api"
	"github.com/soroban-anchor-gate/relay/internal/listener"
	"github.com/soroban-anchor-gate/relay/internal/store"
	"github.com/soroban-anchor-gate/relay/internal/store/migrations"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	// Support CLI database migration subcommands: `relay migrate down`, `relay migrate up`, `relay migrate version`
	if len(os.Args) > 1 && os.Args[1] == "migrate" {
		handleMigrateCommand(logger, os.Args[2:])
		return
	}

	contractID := os.Getenv("SOROBAN_CONTRACT_ID")
	if contractID == "" {
		contractID = "CBIHLECKLMXYK6FPHSGGVYF6AHNFRHR3T5EIFIS3PFQDFKDQWNR25PHT"
	}

	rpcURL := os.Getenv("SOROBAN_RPC_URL")
	if rpcURL == "" {
		rpcURL = "https://soroban-testnet.stellar.org"
	}

	apiPort := os.Getenv("PORT")
	if apiPort == "" {
		apiPort = "8080"
	}

	var startLedger uint32 = 0
	if s := os.Getenv("START_LEDGER"); s != "" {
		if val, err := strconv.ParseUint(s, 10, 32); err == nil {
			startLedger = uint32(val)
		}
	}

	storePath := os.Getenv("STORE_PATH")
	if storePath == "" {
		storePath = "data/relay_store.json"
	}

	var relayStore store.IdempotencyStore
	if storePath == ":memory:" {
		relayStore = store.NewMemoryStore(startLedger)
	} else {
		durableStore, err := store.NewDurableFileStore(storePath, startLedger)
		if err != nil {
			logger.Error("Failed to initialize durable file store, using memory store fallback", "error", err)
			relayStore = store.NewMemoryStore(startLedger)
		} else {
			relayStore = durableStore
			defer durableStore.Close()
		}
	}

	logger.Info("SorobanAnchor Gate Relay daemon starting",
		"rpc_url", rpcURL,
		"contract_id", contractID,
		"start_ledger", relayStore.GetCursor(),
		"store_path", storePath,
		"api_port", apiPort,
	)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	// Start HTTP API monitoring server
	apiServer := api.NewServer(contractID, rpcURL, relayStore)
	httpServer := &http.Server{
		Addr:         ":" + apiPort,
		Handler:      apiServer.Handler(),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	go func() {
		logger.Info("Relay HTTP API server listening", "port", apiPort)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("HTTP API server failure", "error", err)
		}
	}()

	// Run pending database migrations atomically before listener initialization if DATABASE_URL is configured
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL != "" {
		logger.Info("DATABASE_URL configured; running pending database migrations")
		db, err := sql.Open("postgres", dbURL)
		if err != nil {
			logger.Error("Failed to open database for migrations", "error", err)
			os.Exit(1)
		}
		defer db.Close()

		migCtx, migCancel := context.WithTimeout(context.Background(), 30*time.Second)
		migrator := migrations.NewMigrator(db, logger)
		if err := migrator.RunPending(migCtx); err != nil {
			migCancel()
			logger.Error("Automated database migration failed on boot", "error", err)
			os.Exit(1)
		}
		migCancel()
		logger.Info("Automated database migrations completed successfully")
	}

	eventChan := make(chan listener.EventPayload, 100)
	sub := listener.NewEventSubscriber(rpcURL, contractID, relayStore, logger)

	go func() {
		if err := sub.PollEvents(ctx, eventChan); err != nil && !errors.Is(err, context.Canceled) {
			logger.Error("Event poller failure", "error", err)
		}
	}()

	go func() {
		for {
			select {
			case payload, ok := <-eventChan:
				if !ok {
					return
				}
				logger.Info("Relay received contract event",
					"event_id", payload.EventID,
					"escrow_id", payload.EscrowID,
					"amount", payload.PayoutAmount.String(),
					"profile_hash", payload.ProfileHashHex,
				)

				// Complete processing after downstream handling
				if err := relayStore.MarkCompleted(payload.EventID); err != nil {
					logger.Error("Failed to mark event completed", "event_id", payload.EventID, "error", err)
				}
			case <-ctx.Done():
				return
			}
		}
	}()

	<-ctx.Done()
	logger.Info("Shutting down relay daemon gracefully")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	_ = httpServer.Shutdown(shutdownCtx)
}

func handleMigrateCommand(logger *slog.Logger, args []string) {
	if len(args) == 0 {
		fmt.Println("Usage: relay migrate [up|down|version]")
		os.Exit(1)
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		logger.Error("DATABASE_URL environment variable is required for migrations")
		os.Exit(1)
	}

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		logger.Error("Failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	migrator := migrations.NewMigrator(db, logger)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	switch args[0] {
	case "up":
		if err := migrator.RunPending(ctx); err != nil {
			logger.Error("Failed to run pending migrations", "error", err)
			os.Exit(1)
		}
		logger.Info("Migrations applied successfully")
	case "down":
		if err := migrator.RollbackLatest(ctx); err != nil {
			logger.Error("Failed to rollback migration", "error", err)
			os.Exit(1)
		}
		logger.Info("Migration rollback completed successfully")
	case "version":
		ver, dirty, err := migrator.GetVersion(ctx)
		if err != nil {
			logger.Error("Failed to get migration version", "error", err)
			os.Exit(1)
		}
		logger.Info("Current migration version", "version", ver, "dirty", dirty)
	default:
		logger.Error("Unknown migration command", "command", args[0])
		os.Exit(1)
	}
}
