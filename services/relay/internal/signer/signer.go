package signer

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strings"
)

// KeyManager defines the interface for Ed25519 cryptographic signing operations.
type KeyManager interface {
	// PublicKey returns the Ed25519 public key associated with the managed key.
	PublicKey(ctx context.Context) (ed25519.PublicKey, error)
	// Sign signs a message payload and returns an Ed25519 signature.
	Sign(ctx context.Context, message []byte) ([]byte, error)
}

// Config specifies the key manager configuration and provider selection.
type Config struct {
	// Provider determines the backing key store ("kms", "vault", or "env").
	Provider string
	// KMSKeyID identifies the key in AWS KMS.
	KMSKeyID string
	// KMSClient optional preconfigured KMS client.
	KMSClient KMSClient
	// VaultKeyName identifies the key in HashiCorp Vault transit engine.
	VaultKeyName string
	// VaultClient optional preconfigured Vault client.
	VaultClient VaultClient
	// EnvVarName specifies the environment variable holding the seed/key (defaults to RELAY_SIGNER_KEY).
	EnvVarName string
}

// EnvKeyManager implements KeyManager using an Ed25519 private key read from memory or environment.
type EnvKeyManager struct {
	privateKey ed25519.PrivateKey
	publicKey  ed25519.PublicKey
}

// NewEnvKeyManager creates an EnvKeyManager from an explicit Ed25519 private key or seed.
func NewEnvKeyManager(key ed25519.PrivateKey) (*EnvKeyManager, error) {
	if len(key) == ed25519.SeedSize {
		priv := ed25519.NewKeyFromSeed(key)
		return &EnvKeyManager{
			privateKey: priv,
			publicKey:  priv.Public().(ed25519.PublicKey),
		}, nil
	}
	if len(key) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("invalid ed25519 private key length: got %d, expected %d", len(key), ed25519.PrivateKeySize)
	}
	return &EnvKeyManager{
		privateKey: key,
		publicKey:  key.Public().(ed25519.PublicKey),
	}, nil
}

// NewEnvKeyManagerFromHex creates an EnvKeyManager from a hex-encoded private key or seed string.
func NewEnvKeyManagerFromHex(hexKey string) (*EnvKeyManager, error) {
	clean := strings.TrimSpace(hexKey)
	if clean == "" {
		return nil, errors.New("hex key cannot be empty")
	}
	decoded, err := hex.DecodeString(clean)
	if err != nil {
		return nil, fmt.Errorf("failed to decode hex key: %w", err)
	}
	return NewEnvKeyManager(decoded)
}

// GenerateEphemeralKeyManager creates an in-memory ephemeral KeyManager for testing.
func GenerateEphemeralKeyManager() (*EnvKeyManager, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("failed to generate ephemeral key: %w", err)
	}
	return &EnvKeyManager{
		privateKey: priv,
		publicKey:  pub,
	}, nil
}

// PublicKey returns the Ed25519 public key.
func (m *EnvKeyManager) PublicKey(_ context.Context) (ed25519.PublicKey, error) {
	return m.publicKey, nil
}

// Sign signs the message using the Ed25519 private key.
func (m *EnvKeyManager) Sign(_ context.Context, message []byte) ([]byte, error) {
	if len(message) == 0 {
		return nil, errors.New("cannot sign empty message")
	}
	sig := ed25519.Sign(m.privateKey, message)
	return sig, nil
}

// NewKeyManager initializes a KeyManager based on the provided configuration,
// automatically falling back to environment variable configuration for local development.
func NewKeyManager(cfg Config) (KeyManager, error) {
	provider := strings.ToLower(strings.TrimSpace(cfg.Provider))

	switch provider {
	case "kms":
		if cfg.KMSKeyID != "" {
			return NewKMSKeyManager(cfg.KMSClient, cfg.KMSKeyID)
		}
	case "vault":
		if cfg.VaultKeyName != "" && cfg.VaultClient != nil {
			return NewVaultKeyManager(cfg.VaultClient, cfg.VaultKeyName)
		}
	}

	// Fallback to environment variable
	envVar := cfg.EnvVarName
	if envVar == "" {
		envVar = "RELAY_SIGNER_KEY"
	}

	rawKey := os.Getenv(envVar)
	if rawKey != "" {
		return NewEnvKeyManagerFromHex(rawKey)
	}

	// If KMS was explicitly requested without key ID, return specific error
	if provider == "kms" {
		return nil, errors.New("KMS provider selected but KMSKeyID is empty")
	}
	if provider == "vault" {
		return nil, errors.New("Vault provider selected but VaultKeyName or VaultClient is missing")
	}

	// Default fallback when no config exists: generate ephemeral or return descriptive error
	return nil, fmt.Errorf("no signing key configured: specify KMSKeyID or set %s environment variable", envVar)
}
