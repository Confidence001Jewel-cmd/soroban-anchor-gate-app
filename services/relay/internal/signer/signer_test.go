package signer

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"os"
	"testing"
)

// mockKMSClient implements KMSClient with an in-memory Ed25519 key for testing.
type mockKMSClient struct {
	privKey    ed25519.PrivateKey
	pubKey     ed25519.PublicKey
	failSign   bool
	failGetPub bool
}

func newMockKMSClient(t *testing.T) *mockKMSClient {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}
	return &mockKMSClient{
		privKey: priv,
		pubKey:  pub,
	}
}

func (m *mockKMSClient) Sign(_ context.Context, params *SignInput) (*SignOutput, error) {
	if m.failSign {
		return nil, errors.New("simulated KMS sign failure")
	}
	sig := ed25519.Sign(m.privKey, params.Message)
	return &SignOutput{
		Signature: sig,
		KeyId:     params.KeyId,
	}, nil
}

func (m *mockKMSClient) GetPublicKey(_ context.Context, params *GetPublicKeyInput) (*GetPublicKeyOutput, error) {
	if m.failGetPub {
		return nil, errors.New("simulated KMS get public key failure")
	}
	der, err := x509.MarshalPKIXPublicKey(m.pubKey)
	if err != nil {
		return nil, err
	}
	return &GetPublicKeyOutput{
		PublicKey: der,
		KeyId:     params.KeyId,
		KeySpec:   "ED25519_KEY_PAIR",
	}, nil
}

// mockVaultClient implements VaultClient in-memory for testing.
type mockVaultClient struct {
	privKey ed25519.PrivateKey
	pubKey  ed25519.PublicKey
}

func newMockVaultClient(t *testing.T) *mockVaultClient {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}
	return &mockVaultClient{
		privKey: priv,
		pubKey:  pub,
	}
}

func (v *mockVaultClient) SignData(_ context.Context, _ string, inputB64 string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(inputB64)
	if err != nil {
		return "", err
	}
	sig := ed25519.Sign(v.privKey, data)
	return base64.StdEncoding.EncodeToString(sig), nil
}

func (v *mockVaultClient) ReadPublicKey(_ context.Context, _ string) (string, error) {
	return base64.StdEncoding.EncodeToString(v.pubKey), nil
}

func TestKMSKeyManager_SignAndVerify(t *testing.T) {
	ctx := context.Background()
	mockClient := newMockKMSClient(t)

	km, err := NewKMSKeyManager(mockClient, "alias/soroban-relay-key")
	if err != nil {
		t.Fatalf("unexpected NewKMSKeyManager error: %v", err)
	}

	pub, err := km.PublicKey(ctx)
	if err != nil {
		t.Fatalf("PublicKey error: %v", err)
	}

	if !pub.Equal(mockClient.pubKey) {
		t.Errorf("public key mismatch: expected %v, got %v", mockClient.pubKey, pub)
	}

	msg := []byte("stellar-transaction-hash-payload-12345")
	sig, err := km.Sign(ctx, msg)
	if err != nil {
		t.Fatalf("Sign error: %v", err)
	}

	if len(sig) != ed25519.SignatureSize {
		t.Errorf("expected signature length %d, got %d", ed25519.SignatureSize, len(sig))
	}

	if !ed25519.Verify(pub, msg, sig) {
		t.Error("Ed25519 verification failed for KMS signature")
	}
}

func TestKMSKeyManager_Failures(t *testing.T) {
	ctx := context.Background()
	mockClient := newMockKMSClient(t)
	km, _ := NewKMSKeyManager(mockClient, "key-123")

	// Empty message
	if _, err := km.Sign(ctx, nil); err == nil {
		t.Error("expected error signing empty message, got nil")
	}

	// Sign failure
	mockClient.failSign = true
	if _, err := km.Sign(ctx, []byte("test")); err == nil {
		t.Error("expected KMS sign error, got nil")
	}

	// GetPublicKey failure
	mockClient2 := newMockKMSClient(t)
	mockClient2.failGetPub = true
	km2, _ := NewKMSKeyManager(mockClient2, "key-123")
	if _, err := km2.PublicKey(ctx); err == nil {
		t.Error("expected KMS get public key error, got nil")
	}
}

func TestEnvKeyManager_SignAndVerify(t *testing.T) {
	ctx := context.Background()
	seed := make([]byte, ed25519.SeedSize)
	for i := range seed {
		seed[i] = byte(i + 1)
	}

	km, err := NewEnvKeyManager(seed)
	if err != nil {
		t.Fatalf("NewEnvKeyManager error: %v", err)
	}

	pub, err := km.PublicKey(ctx)
	if err != nil {
		t.Fatalf("PublicKey error: %v", err)
	}

	msg := []byte("hello-relay-signer")
	sig, err := km.Sign(ctx, msg)
	if err != nil {
		t.Fatalf("Sign error: %v", err)
	}

	if !ed25519.Verify(pub, msg, sig) {
		t.Error("Ed25519 signature verification failed for EnvKeyManager")
	}
}

func TestVaultKeyManager_SignAndVerify(t *testing.T) {
	ctx := context.Background()
	mockVault := newMockVaultClient(t)

	km, err := NewVaultKeyManager(mockVault, "soroban-relay-key")
	if err != nil {
		t.Fatalf("NewVaultKeyManager error: %v", err)
	}

	pub, err := km.PublicKey(ctx)
	if err != nil {
		t.Fatalf("PublicKey error: %v", err)
	}

	msg := []byte("vault-payload-to-sign")
	sig, err := km.Sign(ctx, msg)
	if err != nil {
		t.Fatalf("Sign error: %v", err)
	}

	if !ed25519.Verify(pub, msg, sig) {
		t.Error("Ed25519 signature verification failed for VaultKeyManager")
	}
}

func TestNewKeyManager_FallbackToEnv(t *testing.T) {
	ctx := context.Background()
	seed := make([]byte, ed25519.SeedSize)
	for i := range seed {
		seed[i] = 0xAA
	}
	hexSeed := hex.EncodeToString(seed)

	envVar := "TEST_SIGNER_KEY_FALLBACK"
	os.Setenv(envVar, hexSeed)
	defer os.Unsetenv(envVar)

	// Config with no KMS/Vault specified -> falls back to environment variable
	km, err := NewKeyManager(Config{
		Provider:   "",
		EnvVarName: envVar,
	})
	if err != nil {
		t.Fatalf("NewKeyManager fallback failed: %v", err)
	}

	pub, err := km.PublicKey(ctx)
	if err != nil {
		t.Fatalf("PublicKey error: %v", err)
	}

	expectedPub := ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey)
	if !pub.Equal(expectedPub) {
		t.Errorf("expected public key %v, got %v", expectedPub, pub)
	}
}

func TestNewKeyManager_Validation(t *testing.T) {
	// Provider is KMS but no KeyID
	_, err := NewKeyManager(Config{
		Provider: "kms",
	})
	if err == nil {
		t.Error("expected error for empty KMSKeyID, got nil")
	}

	// Provider is Vault but no client
	_, err = NewKeyManager(Config{
		Provider:     "vault",
		VaultKeyName: "key",
	})
	if err == nil {
		t.Error("expected error for missing Vault client, got nil")
	}
}
