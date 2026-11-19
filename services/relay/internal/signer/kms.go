package signer

import (
	"context"
	"crypto/ed25519"
	"crypto/x509"
	"errors"
	"fmt"
)

// SignInput represents the input parameters to an AWS KMS Sign call.
type SignInput struct {
	KeyId            string
	Message          []byte
	MessageType      string
	SigningAlgorithm string
}

// SignOutput represents the output returned by an AWS KMS Sign call.
type SignOutput struct {
	Signature []byte
	KeyId     string
}

// GetPublicKeyInput represents the input parameters to an AWS KMS GetPublicKey call.
type GetPublicKeyInput struct {
	KeyId string
}

// GetPublicKeyOutput represents the output returned by an AWS KMS GetPublicKey call.
type GetPublicKeyOutput struct {
	PublicKey []byte
	KeyId     string
	KeySpec   string
}

// KMSClient represents the AWS KMS client interface required by KMSKeyManager.
type KMSClient interface {
	Sign(ctx context.Context, params *SignInput) (*SignOutput, error)
	GetPublicKey(ctx context.Context, params *GetPublicKeyInput) (*GetPublicKeyOutput, error)
}

// KMSKeyManager implements KeyManager delegating Ed25519 signing to AWS KMS.
type KMSKeyManager struct {
	client    KMSClient
	keyID     string
	cachedPub ed25519.PublicKey
}

// NewKMSKeyManager creates an AWS KMS-backed KeyManager.
func NewKMSKeyManager(client KMSClient, keyID string) (*KMSKeyManager, error) {
	if client == nil {
		return nil, errors.New("KMS client cannot be nil")
	}
	if keyID == "" {
		return nil, errors.New("KMS key ID cannot be empty")
	}
	return &KMSKeyManager{
		client: client,
		keyID:  keyID,
	}, nil
}

// PublicKey fetches and caches the Ed25519 public key from AWS KMS.
func (m *KMSKeyManager) PublicKey(ctx context.Context) (ed25519.PublicKey, error) {
	if len(m.cachedPub) == ed25519.PublicKeySize {
		return m.cachedPub, nil
	}

	out, err := m.client.GetPublicKey(ctx, &GetPublicKeyInput{
		KeyId: m.keyID,
	})
	if err != nil {
		return nil, fmt.Errorf("KMS GetPublicKey failed for key %s: %w", m.keyID, err)
	}

	// Try DER-encoded SubjectPublicKeyInfo parsing first
	parsedKey, err := x509.ParsePKIXPublicKey(out.PublicKey)
	if err == nil {
		if edPub, ok := parsedKey.(ed25519.PublicKey); ok {
			m.cachedPub = edPub
			return m.cachedPub, nil
		}
		return nil, fmt.Errorf("KMS key %s is not an ed25519 key (got %T)", m.keyID, parsedKey)
	}

	// If raw 32 bytes were returned directly (e.g. from mock/raw endpoint)
	if len(out.PublicKey) == ed25519.PublicKeySize {
		m.cachedPub = ed25519.PublicKey(out.PublicKey)
		return m.cachedPub, nil
	}

	return nil, fmt.Errorf("failed to parse KMS public key for %s: %w", m.keyID, err)
}

// Sign delegates message signing to AWS KMS using the ED25519_RAW or ED25519 algorithm.
func (m *KMSKeyManager) Sign(ctx context.Context, message []byte) ([]byte, error) {
	if len(message) == 0 {
		return nil, errors.New("cannot sign empty message")
	}

	input := &SignInput{
		KeyId:            m.keyID,
		Message:          message,
		MessageType:      "RAW",
		SigningAlgorithm: "ED25519_RAW",
	}

	out, err := m.client.Sign(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("KMS Sign request failed for key %s: %w", m.keyID, err)
	}

	if len(out.Signature) != ed25519.SignatureSize {
		return nil, fmt.Errorf("invalid signature length from KMS: got %d, expected %d", len(out.Signature), ed25519.SignatureSize)
	}

	return out.Signature, nil
}
