package signer

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"fmt"
)

// VaultClient represents a client interface for HashiCorp Vault Transit secrets engine.
type VaultClient interface {
	SignData(ctx context.Context, keyName string, inputBase64 string) (signatureBase64 string, err error)
	ReadPublicKey(ctx context.Context, keyName string) (pubKeyBase64 string, err error)
}

// VaultKeyManager implements KeyManager delegating Ed25519 signing to HashiCorp Vault Transit secrets engine.
type VaultKeyManager struct {
	client    VaultClient
	keyName   string
	cachedPub ed25519.PublicKey
}

// NewVaultKeyManager creates a new VaultKeyManager instance.
func NewVaultKeyManager(client VaultClient, keyName string) (*VaultKeyManager, error) {
	if client == nil {
		return nil, errors.New("vault client cannot be nil")
	}
	if keyName == "" {
		return nil, errors.New("vault key name cannot be empty")
	}
	return &VaultKeyManager{
		client:  client,
		keyName: keyName,
	}, nil
}

// PublicKey fetches and caches the Ed25519 public key from HashiCorp Vault.
func (m *VaultKeyManager) PublicKey(ctx context.Context) (ed25519.PublicKey, error) {
	if len(m.cachedPub) == ed25519.PublicKeySize {
		return m.cachedPub, nil
	}

	pubB64, err := m.client.ReadPublicKey(ctx, m.keyName)
	if err != nil {
		return nil, fmt.Errorf("failed to read public key from Vault for %s: %w", m.keyName, err)
	}

	pubBytes, err := base64.StdEncoding.DecodeString(pubB64)
	if err != nil {
		return nil, fmt.Errorf("failed to decode Vault public key base64: %w", err)
	}

	if len(pubBytes) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("invalid ed25519 public key size from Vault: got %d, expected %d", len(pubBytes), ed25519.PublicKeySize)
	}

	m.cachedPub = ed25519.PublicKey(pubBytes)
	return m.cachedPub, nil
}

// Sign delegates signing to Vault transit engine.
func (m *VaultKeyManager) Sign(ctx context.Context, message []byte) ([]byte, error) {
	if len(message) == 0 {
		return nil, errors.New("cannot sign empty message")
	}

	inputB64 := base64.StdEncoding.EncodeToString(message)
	sigB64, err := m.client.SignData(ctx, m.keyName, inputB64)
	if err != nil {
		return nil, fmt.Errorf("vault transit signing failed for %s: %w", m.keyName, err)
	}

	sigBytes, err := base64.StdEncoding.DecodeString(sigB64)
	if err != nil {
		return nil, fmt.Errorf("failed to decode Vault signature base64: %w", err)
	}

	if len(sigBytes) != ed25519.SignatureSize {
		return nil, fmt.Errorf("invalid signature length from Vault: got %d, expected %d", len(sigBytes), ed25519.SignatureSize)
	}

	return sigBytes, nil
}
