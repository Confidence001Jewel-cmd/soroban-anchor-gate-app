extern crate std;

use super::*;
use crate::types::{DisbursementCommitment, EscrowEntry};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events as _, Ledger as _},
    token::Client as TokenClient,
    token::StellarAssetClient,
    vec, Address, BytesN, Env, Symbol, TryFromVal, Vec,
};

fn setup_test_env<'a>(
    env: &'a Env,
    initial_balance: i128,
) -> (
    EscrowGateClient<'a>,
    Address,
    Address,
    Address,
    Address,
    Address,
    Address,
    TokenClient<'a>,
    StellarAssetClient<'a>,
) {
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    let payer = Address::generate(env);
    let beneficiary = Address::generate(env);
    let anchor_addr = Address::generate(env);

    let token_admin = Address::generate(env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin);
    let token_client = TokenClient::new(env, &token_contract.address());
    let token_admin_client = StellarAssetClient::new(env, &token_contract.address());

    if initial_balance > 0 {
        token_admin_client.mint(&payer, &initial_balance);
    }

    let contract_id = env.register(EscrowGate, ());
    let client = EscrowGateClient::new(env, &contract_id);

    (
        client,
        contract_id,
        admin,
        treasury,
        payer,
        beneficiary,
        anchor_addr,
        token_client,
        token_admin_client,
    )
}

#[test]
fn test_init_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, contract_id, admin, treasury, _, _, _, _, _) = setup_test_env(&env, 0);

    let res = client.try_init(&admin, &treasury, &200);
    assert!(res.is_ok());

    // Verify instance storage reflects initialization parameters
    env.as_contract(&contract_id, || {
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        let stored_treasury: Address = env.storage().instance().get(&DataKey::Treasury).unwrap();
        let stored_fee: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap();
        let stored_counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::EscrowCounter)
            .unwrap();

        assert_eq!(stored_admin, admin);
        assert_eq!(stored_treasury, treasury);
        assert_eq!(stored_fee, 200);
        assert_eq!(stored_counter, 0);
    });
}

#[test]
fn test_init_duplicate_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, admin, treasury, _, _, _, _, _) = setup_test_env(&env, 0);

    assert!(client.try_init(&admin, &treasury, &200).is_ok());

    let res = client.try_init(&admin, &treasury, &100);
    assert_eq!(res, Err(Ok(EscrowError::AlreadyInitialized)));
}

#[test]
fn test_init_excessive_fee_bps_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, admin, treasury, _, _, _, _, _) = setup_test_env(&env, 0);

    // Max allowable is 1000 bps (10%)
    let res = client.try_init(&admin, &treasury, &1001);
    assert_eq!(res, Err(Ok(EscrowError::InvalidBps)));

    let res_max = client.try_init(&admin, &treasury, &1000);
    assert!(res_max.is_ok());
}

#[test]
fn test_init_requires_auth() {
    let env = Env::default();
    let (client, _, admin, treasury, _, _, _, _, _) = setup_test_env(&env, 0);

    // Calling init without mock_all_auths should verify admin authentication
    client.mock_all_auths().init(&admin, &treasury, &250);
    let auths = env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, admin);
}

#[test]
fn test_create_escrow_uninitialized_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _, _, payer, beneficiary, _, token_client, _) = setup_test_env(&env, 10_000);
    let profile_hash = BytesN::from_array(&env, &[1u8; 32]);

    let res = client.try_create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &1_000,
        &profile_hash,
        &86400,
    );

    assert_eq!(res, Err(Ok(EscrowError::NotInitialized)));
}

#[test]
fn test_create_escrow_zero_or_negative_amount_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, admin, treasury, payer, beneficiary, _, token_client, _) =
        setup_test_env(&env, 10_000);
    client.init(&admin, &treasury, &200);

    let profile_hash = BytesN::from_array(&env, &[2u8; 32]);

    let res_zero = client.try_create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &0,
        &profile_hash,
        &86400,
    );
    assert_eq!(res_zero, Err(Ok(EscrowError::ZeroAmount)));

    let res_negative = client.try_create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &-500,
        &profile_hash,
        &86400,
    );
    assert_eq!(res_negative, Err(Ok(EscrowError::ZeroAmount)));
}

#[test]
fn test_create_escrow_success_and_state_verification() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, contract_id, admin, treasury, payer, beneficiary, _, token_client, _) =
        setup_test_env(&env, 50_000);
    client.init(&admin, &treasury, &200);

    env.ledger().with_mut(|l| l.timestamp = 1_000_000);

    let profile_hash = BytesN::from_array(&env, &[3u8; 32]);
    let lock_duration = 3600u64;

    let escrow_id = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &20_000,
        &profile_hash,
        &lock_duration,
    );

    assert_eq!(escrow_id, 1);
    assert_eq!(token_client.balance(&contract_id), 20_000);
    assert_eq!(token_client.balance(&payer), 30_000);

    // Verify record in persistent storage
    env.as_contract(&contract_id, || {
        let key = DataKey::Escrow(escrow_id);
        let record: EscrowRecord = env.storage().persistent().get(&key).unwrap();

        assert_eq!(record.payer, payer);
        assert_eq!(record.beneficiary, beneficiary);
        assert_eq!(record.token, token_client.address);
        assert_eq!(record.amount, 20_000);
        assert_eq!(record.profile_hash, profile_hash);
        assert_eq!(record.status, EscrowStatus::Funded);
        assert_eq!(record.unlock_timestamp, 1_000_000 + lock_duration);
    });
}

#[test]
fn test_create_escrow_counter_increments_deterministically() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, admin, treasury, payer, beneficiary, _, token_client, _) =
        setup_test_env(&env, 100_000);
    client.init(&admin, &treasury, &150);

    let profile_hash = BytesN::from_array(&env, &[4u8; 32]);

    let id1 = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &5_000,
        &profile_hash,
        &1000,
    );
    let id2 = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &5_000,
        &profile_hash,
        &1000,
    );
    let id3 = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &5_000,
        &profile_hash,
        &1000,
    );

    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(id3, 3);
}

#[test]
fn test_release_to_anchor_by_payer() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, contract_id, admin, treasury, payer, beneficiary, anchor_addr, token_client, _) =
        setup_test_env(&env, 20_000);
    client.init(&admin, &treasury, &200); // 2% fee

    let profile_hash = BytesN::from_array(&env, &[5u8; 32]);
    let escrow_id = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &10_000,
        &profile_hash,
        &5000,
    );

    // Release by payer
    let res = client.try_release_to_anchor(&escrow_id, &payer, &anchor_addr);
    assert!(res.is_ok());

    // 2% of 10,000 = 200 to treasury, 9,800 to anchor
    assert_eq!(token_client.balance(&treasury), 200);
    assert_eq!(token_client.balance(&anchor_addr), 9_800);
    assert_eq!(token_client.balance(&contract_id), 0);

    // Verify record status Disbursed
    env.as_contract(&contract_id, || {
        let record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .unwrap();
        assert_eq!(record.status, EscrowStatus::Disbursed);
    });
}

#[test]
fn test_release_to_anchor_by_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, contract_id, admin, treasury, payer, beneficiary, anchor_addr, token_client, _) =
        setup_test_env(&env, 20_000);
    client.init(&admin, &treasury, &200);

    let profile_hash = BytesN::from_array(&env, &[6u8; 32]);
    let escrow_id = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &10_000,
        &profile_hash,
        &5000,
    );

    // Release by admin is authorized
    let res = client.try_release_to_anchor(&escrow_id, &admin, &anchor_addr);
    assert!(res.is_ok());

    assert_eq!(token_client.balance(&treasury), 200);
    assert_eq!(token_client.balance(&anchor_addr), 9_800);
    assert_eq!(token_client.balance(&contract_id), 0);
}

#[test]
fn test_release_to_anchor_unauthorized_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, admin, treasury, payer, beneficiary, anchor_addr, token_client, _) =
        setup_test_env(&env, 20_000);
    client.init(&admin, &treasury, &200);

    let profile_hash = BytesN::from_array(&env, &[7u8; 32]);
    let escrow_id = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &10_000,
        &profile_hash,
        &5000,
    );

    let unauthorized_caller = Address::generate(&env);
    let res = client.try_release_to_anchor(&escrow_id, &unauthorized_caller, &anchor_addr);
    assert_eq!(res, Err(Ok(EscrowError::Unauthorized)));
}

#[test]
fn test_release_to_anchor_missing_escrow_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, admin, treasury, payer, _, anchor_addr, _, _) = setup_test_env(&env, 10_000);
    client.init(&admin, &treasury, &200);

    let res = client.try_release_to_anchor(&999, &payer, &anchor_addr);
    assert_eq!(res, Err(Ok(EscrowError::EscrowNotFound)));
}

#[test]
fn test_release_to_anchor_duplicate_release_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, admin, treasury, payer, beneficiary, anchor_addr, token_client, _) =
        setup_test_env(&env, 20_000);
    client.init(&admin, &treasury, &200);

    let profile_hash = BytesN::from_array(&env, &[8u8; 32]);
    let escrow_id = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &10_000,
        &profile_hash,
        &5000,
    );

    assert!(client
        .try_release_to_anchor(&escrow_id, &payer, &anchor_addr)
        .is_ok());

    let res_second = client.try_release_to_anchor(&escrow_id, &payer, &anchor_addr);
    assert_eq!(res_second, Err(Ok(EscrowError::InvalidStatus)));
}

#[test]
fn test_release_fee_math_zero_and_max_supported_bps() {
    let env = Env::default();
    env.mock_all_auths();

    // Zero fee (0 bps)
    {
        let (
            client,
            contract_id,
            admin,
            treasury,
            payer,
            beneficiary,
            anchor_addr,
            token_client,
            _,
        ) = setup_test_env(&env, 20_000);
        client.init(&admin, &treasury, &0);

        let profile_hash = BytesN::from_array(&env, &[9u8; 32]);
        let escrow_id = client.create_escrow(
            &payer,
            &beneficiary,
            &token_client.address,
            &10_000,
            &profile_hash,
            &5000,
        );

        client.release_to_anchor(&escrow_id, &payer, &anchor_addr);
        assert_eq!(token_client.balance(&treasury), 0);
        assert_eq!(token_client.balance(&anchor_addr), 10_000);
        assert_eq!(token_client.balance(&contract_id), 0);
    }

    // Max fee (1000 bps / 10%) with rounding check
    {
        let (
            client,
            contract_id,
            admin,
            treasury,
            payer,
            beneficiary,
            anchor_addr,
            token_client,
            _,
        ) = setup_test_env(&env, 20_000);
        client.init(&admin, &treasury, &1000);

        let profile_hash = BytesN::from_array(&env, &[10u8; 32]);
        // 9,999 stroops at 10% = 999 fee, 9,000 remainder
        let escrow_id = client.create_escrow(
            &payer,
            &beneficiary,
            &token_client.address,
            &9_999,
            &profile_hash,
            &5000,
        );

        client.release_to_anchor(&escrow_id, &payer, &anchor_addr);
        assert_eq!(token_client.balance(&treasury), 999);
        assert_eq!(token_client.balance(&anchor_addr), 9_000);
        assert_eq!(token_client.balance(&contract_id), 0);
    }
}

#[test]
fn test_refund_before_unlock_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, admin, treasury, payer, beneficiary, _, token_client, _) =
        setup_test_env(&env, 20_000);
    client.init(&admin, &treasury, &200);

    env.ledger().with_mut(|l| l.timestamp = 500);

    let profile_hash = BytesN::from_array(&env, &[11u8; 32]);
    let escrow_id = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &10_000,
        &profile_hash,
        &1000, // unlock at 1500
    );

    // Attempt refund at timestamp 1499
    env.ledger().with_mut(|l| l.timestamp = 1499);
    let res = client.try_refund(&escrow_id);
    assert_eq!(res, Err(Ok(EscrowError::UnlockTimeNotReached)));
}

#[test]
fn test_refund_after_unlock_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, contract_id, admin, treasury, payer, beneficiary, _, token_client, _) =
        setup_test_env(&env, 20_000);
    client.init(&admin, &treasury, &200);

    env.ledger().with_mut(|l| l.timestamp = 1000);

    let profile_hash = BytesN::from_array(&env, &[12u8; 32]);
    let escrow_id = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &10_000,
        &profile_hash,
        &500, // unlock at 1500
    );

    assert_eq!(token_client.balance(&payer), 10_000);
    assert_eq!(token_client.balance(&contract_id), 10_000);

    // Advance past unlock time
    env.ledger().with_mut(|l| l.timestamp = 1500);

    let res = client.try_refund(&escrow_id);
    assert!(res.is_ok());

    // 100% of amount returned to payer
    assert_eq!(token_client.balance(&payer), 20_000);
    assert_eq!(token_client.balance(&contract_id), 0);

    // Verify record status Refunded
    env.as_contract(&contract_id, || {
        let record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .unwrap();
        assert_eq!(record.status, EscrowStatus::Refunded);
    });
}

#[test]
fn test_refund_duplicate_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, admin, treasury, payer, beneficiary, _, token_client, _) =
        setup_test_env(&env, 20_000);
    client.init(&admin, &treasury, &200);

    env.ledger().with_mut(|l| l.timestamp = 1000);

    let profile_hash = BytesN::from_array(&env, &[13u8; 32]);
    let escrow_id = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &10_000,
        &profile_hash,
        &500,
    );

    env.ledger().with_mut(|l| l.timestamp = 1500);
    assert!(client.try_refund(&escrow_id).is_ok());

    let res_second = client.try_refund(&escrow_id);
    assert_eq!(res_second, Err(Ok(EscrowError::InvalidStatus)));
}

#[test]
fn test_release_after_refund_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, admin, treasury, payer, beneficiary, anchor_addr, token_client, _) =
        setup_test_env(&env, 20_000);
    client.init(&admin, &treasury, &200);

    env.ledger().with_mut(|l| l.timestamp = 1000);

    let profile_hash = BytesN::from_array(&env, &[14u8; 32]);
    let escrow_id = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &10_000,
        &profile_hash,
        &500,
    );

    env.ledger().with_mut(|l| l.timestamp = 1500);
    client.refund(&escrow_id);

    let res = client.try_release_to_anchor(&escrow_id, &payer, &anchor_addr);
    assert_eq!(res, Err(Ok(EscrowError::InvalidStatus)));
}

#[test]
fn test_refund_after_release_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, admin, treasury, payer, beneficiary, anchor_addr, token_client, _) =
        setup_test_env(&env, 20_000);
    client.init(&admin, &treasury, &200);

    env.ledger().with_mut(|l| l.timestamp = 1000);

    let profile_hash = BytesN::from_array(&env, &[15u8; 32]);
    let escrow_id = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &10_000,
        &profile_hash,
        &500,
    );

    client.release_to_anchor(&escrow_id, &payer, &anchor_addr);

    // Advance timestamp past lock
    env.ledger().with_mut(|l| l.timestamp = 2000);

    let res = client.try_refund(&escrow_id);
    assert_eq!(res, Err(Ok(EscrowError::InvalidStatus)));
}

#[test]
fn test_event_schemas_emitted() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, contract_id, admin, treasury, payer, beneficiary, anchor_addr, token_client, _) =
        setup_test_env(&env, 30_000);
    client.init(&admin, &treasury, &200);

    env.ledger().with_mut(|l| l.timestamp = 1000);

    let profile_hash = BytesN::from_array(&env, &[16u8; 32]);
    let escrow_id = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &10_000,
        &profile_hash,
        &500,
    );

    // Inspect created event
    let events = env.events().all();
    let created_event = events
        .iter()
        .find(|e| {
            if e.0 != contract_id || e.1.len() != 2 {
                return false;
            }
            let topic: Result<Symbol, _> = Symbol::try_from_val(&env, &e.1.get(0).unwrap());
            topic == Ok(symbol_short!("created"))
        })
        .expect("created event not found");

    let event_escrow_id: u64 = u64::try_from_val(&env, &created_event.1.get(1).unwrap()).unwrap();
    assert_eq!(event_escrow_id, escrow_id);

    // Release to anchor and inspect disbursed event
    client.release_to_anchor(&escrow_id, &payer, &anchor_addr);

    let events = env.events().all();
    let disbursed_event = events
        .iter()
        .find(|e| {
            if e.0 != contract_id || e.1.len() != 2 {
                return false;
            }
            let topic: Result<Symbol, _> = Symbol::try_from_val(&env, &e.1.get(0).unwrap());
            topic == Ok(Symbol::new(&env, "disbursed"))
        })
        .expect("disbursed event not found");

    let disbursed_id: u64 = u64::try_from_val(&env, &disbursed_event.1.get(1).unwrap()).unwrap();
    assert_eq!(disbursed_id, escrow_id);

    // Create a second escrow to verify refunded event
    let escrow_id_2 = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &5_000,
        &profile_hash,
        &200,
    );
    env.ledger().with_mut(|l| l.timestamp = 1300);
    client.refund(&escrow_id_2);

    let events = env.events().all();
    let refunded_event = events
        .iter()
        .find(|e| {
            if e.0 != contract_id || e.1.len() != 2 {
                return false;
            }
            let topic: Result<Symbol, _> = Symbol::try_from_val(&env, &e.1.get(0).unwrap());
            topic == Ok(Symbol::new(&env, "refunded"))
        })
        .expect("refunded event not found");

    let refunded_id: u64 = u64::try_from_val(&env, &refunded_event.1.get(1).unwrap()).unwrap();
    assert_eq!(refunded_id, escrow_id_2);
}

#[test]
fn test_create_escrow_overflow_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, admin, treasury, payer, beneficiary, _, token_client, _) =
        setup_test_env(&env, 20_000);
    client.init(&admin, &treasury, &200);

    let profile_hash = BytesN::from_array(&env, &[16u8; 32]);

    // Test timestamp overflow: current_time (1000) + lock_duration (u64::MAX) overflows
    env.ledger().with_mut(|l| l.timestamp = 1000);
    let res_overflow = client.try_create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &10_000,
        &profile_hash,
        &u64::MAX,
    );
    assert_eq!(res_overflow, Err(Ok(EscrowError::ArithmeticOverflow)));
}

#[test]
fn test_whitelist_unauthorized_caller_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, admin, treasury, payer, _, _, token_client, _) = setup_test_env(&env, 10_000);
    client.init(&admin, &treasury, &200);

    let res = client.try_set_token_whitelist(&payer, &token_client.address, &true);
    assert_eq!(res, Err(Ok(EscrowError::Unauthorized)));
}

#[test]
fn test_whitelist_enforcement_and_unauthorized_token_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, admin, treasury, payer, beneficiary, _, token_client, _) =
        setup_test_env(&env, 20_000);
    client.init(&admin, &treasury, &200);

    // Create a second non-whitelisted token
    let other_token_admin = Address::generate(&env);
    let other_token_contract = env.register_stellar_asset_contract_v2(other_token_admin);
    let other_token_admin_client = StellarAssetClient::new(&env, &other_token_contract.address());
    let other_token_client = TokenClient::new(&env, &other_token_contract.address());
    other_token_admin_client.mint(&payer, &10_000);

    // Whitelist the primary token
    assert!(client.is_token_whitelisted(&token_client.address));
    client.set_token_whitelist(&admin, &token_client.address, &true);
    assert!(client.is_token_whitelisted(&token_client.address));
    assert!(!client.is_token_whitelisted(&other_token_client.address));

    let profile_hash = BytesN::from_array(&env, &[7u8; 32]);

    // Attempting escrow with non-whitelisted token must fail
    let res_rejected = client.try_create_escrow(
        &payer,
        &beneficiary,
        &other_token_client.address,
        &5_000,
        &profile_hash,
        &100,
    );
    assert_eq!(res_rejected, Err(Ok(EscrowError::TokenNotWhitelisted)));

    // Escrow with whitelisted token must succeed
    let res_ok = client.try_create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &5_000,
        &profile_hash,
        &100,
    );
    assert!(res_ok.is_ok());
}

#[test]
fn test_resolve_dispute_unauthorized_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, admin, treasury, payer, beneficiary, _, token_client, _) =
        setup_test_env(&env, 20_000);
    client.init(&admin, &treasury, &200);

    let profile_hash = BytesN::from_array(&env, &[9u8; 32]);
    let escrow_id = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &10_000,
        &profile_hash,
        &100,
    );

    // Non-admin cannot resolve dispute
    let res = client.try_resolve_dispute(&escrow_id, &payer, &5_000, &5_000);
    assert_eq!(res, Err(Ok(EscrowError::Unauthorized)));
}

#[test]
fn test_resolve_dispute_invalid_split_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, admin, treasury, payer, beneficiary, _, token_client, _) =
        setup_test_env(&env, 20_000);
    client.init(&admin, &treasury, &200);

    let profile_hash = BytesN::from_array(&env, &[9u8; 32]);
    let escrow_id = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &10_000,
        &profile_hash,
        &100,
    );

    // Splits that don't sum to 10_000 must fail
    let res_under = client.try_resolve_dispute(&escrow_id, &admin, &4_000, &5_000);
    assert_eq!(res_under, Err(Ok(EscrowError::InvalidDisputeSplit)));

    let res_over = client.try_resolve_dispute(&escrow_id, &admin, &6_000, &5_000);
    assert_eq!(res_over, Err(Ok(EscrowError::InvalidDisputeSplit)));
}

#[test]
fn test_resolve_dispute_success_split() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, contract_id, admin, treasury, payer, beneficiary, _, token_client, _) =
        setup_test_env(&env, 10_000);
    client.init(&admin, &treasury, &200);

    let profile_hash = BytesN::from_array(&env, &[12u8; 32]);
    let escrow_id = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &10_000,
        &profile_hash,
        &100,
    );

    assert_eq!(token_client.balance(&payer), 0);
    assert_eq!(token_client.balance(&beneficiary), 0);
    assert_eq!(token_client.balance(&contract_id), 10_000);

    // Split 60% to payer (6000 bps) and 40% to beneficiary (4000 bps)
    let res = client.try_resolve_dispute(&escrow_id, &admin, &6_000, &4_000);
    assert!(res.is_ok());

    assert_eq!(token_client.balance(&payer), 6_000);
    assert_eq!(token_client.balance(&beneficiary), 4_000);
    assert_eq!(token_client.balance(&contract_id), 0);

    // Record should reflect Disputed status
    let record = client.get_escrow(&escrow_id);
    assert_eq!(record.status, EscrowStatus::Disputed);

    // Further operations on disputed escrow must fail with InvalidStatus
    let res_dup = client.try_resolve_dispute(&escrow_id, &admin, &5_000, &5_000);
    assert_eq!(res_dup, Err(Ok(EscrowError::InvalidStatus)));
}

#[test]
fn test_getters_and_metadata() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, admin, treasury, payer, beneficiary, _, token_client, _) =
        setup_test_env(&env, 10_000);
    client.init(&admin, &treasury, &250);

    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_treasury(), treasury);
    assert_eq!(client.get_fee_bps(), 250);
    assert_eq!(client.get_counter(), 0);

    let profile_hash = BytesN::from_array(&env, &[25u8; 32]);
    let escrow_id = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &5_000,
        &profile_hash,
        &500,
    );

    assert_eq!(client.get_counter(), 1);
    let record = client.get_escrow(&escrow_id);
    assert_eq!(record.payer, payer);
    assert_eq!(record.beneficiary, beneficiary);
    assert_eq!(record.amount, 5_000);
    assert_eq!(record.status, EscrowStatus::Funded);
}

// ============================================================================
// Issue #70 — Beneficiary payout split to multiple bank-account commitments
// ============================================================================

fn commitment(env: &Env, recipient: &Address, amount: i128, tag: u8) -> DisbursementCommitment {
    DisbursementCommitment {
        recipient: recipient.clone(),
        amount,
        commitment_hash: BytesN::from_array(env, &[tag; 32]),
    }
}

/// Initializes the contract with `fee_bps` and funds a single escrow of `amount`.
fn setup_funded_escrow<'a>(
    env: &'a Env,
    fee_bps: u32,
    amount: i128,
) -> (
    EscrowGateClient<'a>,
    Address,
    Address,
    Address,
    Address,
    TokenClient<'a>,
    u64,
) {
    let (client, contract_id, admin, treasury, payer, beneficiary, _, token_client, _) =
        setup_test_env(env, amount);
    client.init(&admin, &treasury, &fee_bps);
    let escrow_id = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &amount,
        &BytesN::from_array(env, &[42u8; 32]),
        &1_000,
    );
    (
        client,
        contract_id,
        admin,
        treasury,
        payer,
        token_client,
        escrow_id,
    )
}

#[test]
fn test_release_split_payout_and_anchor_fee_legs() {
    let env = Env::default();
    env.mock_all_auths();

    // 2% protocol fee: 10_000 -> 200 treasury, 9_800 distributable.
    let (client, contract_id, _, treasury, payer, token_client, escrow_id) =
        setup_funded_escrow(&env, 200, 10_000);

    let customer_bank = Address::generate(&env);
    let anchor_fee_account = Address::generate(&env);

    // 90% payout / 10% anchor fee of the distributable balance.
    let legs = vec![
        &env,
        commitment(&env, &customer_bank, 8_820, 1),
        commitment(&env, &anchor_fee_account, 980, 2),
    ];
    client.release_split(&escrow_id, &payer, &legs);

    assert_eq!(token_client.balance(&treasury), 200);
    assert_eq!(token_client.balance(&customer_bank), 8_820);
    assert_eq!(token_client.balance(&anchor_fee_account), 980);
    assert_eq!(token_client.balance(&contract_id), 0);
    assert_eq!(
        client.get_escrow(&escrow_id).status,
        EscrowStatus::Disbursed
    );
}

#[test]
fn test_release_split_zero_fee_multi_leg() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, contract_id, _, treasury, payer, token_client, escrow_id) =
        setup_funded_escrow(&env, 0, 9_000);

    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);
    let legs = vec![
        &env,
        commitment(&env, &a, 3_000, 1),
        commitment(&env, &b, 5_999, 2),
        commitment(&env, &c, 1, 3),
    ];
    client.release_split(&escrow_id, &payer, &legs);

    assert_eq!(token_client.balance(&treasury), 0);
    assert_eq!(token_client.balance(&a), 3_000);
    assert_eq!(token_client.balance(&b), 5_999);
    assert_eq!(token_client.balance(&c), 1);
    assert_eq!(token_client.balance(&contract_id), 0);
}

#[test]
fn test_release_split_same_recipient_multiple_commitments() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _, _, payer, token_client, escrow_id) = setup_funded_escrow(&env, 0, 1_000);

    // One anchor wallet can settle several distinct bank commitments.
    let anchor = Address::generate(&env);
    let legs = vec![
        &env,
        commitment(&env, &anchor, 400, 1),
        commitment(&env, &anchor, 600, 2),
    ];
    client.release_split(&escrow_id, &payer, &legs);
    assert_eq!(token_client.balance(&anchor), 1_000);
}

#[test]
fn test_release_split_by_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, admin, _, _, token_client, escrow_id) = setup_funded_escrow(&env, 100, 10_000);

    let recipient = Address::generate(&env);
    let legs = vec![&env, commitment(&env, &recipient, 9_900, 1)];
    client.release_split(&escrow_id, &admin, &legs);
    assert_eq!(token_client.balance(&recipient), 9_900);
}

#[test]
fn test_release_split_requires_caller_auth() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _, _, payer, _, escrow_id) = setup_funded_escrow(&env, 0, 1_000);
    let recipient = Address::generate(&env);
    let legs = vec![&env, commitment(&env, &recipient, 1_000, 1)];
    client.release_split(&escrow_id, &payer, &legs);

    let auths = env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, payer);
}

#[test]
fn test_release_split_unauthorized_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _, _, _, _, escrow_id) = setup_funded_escrow(&env, 0, 1_000);
    let stranger = Address::generate(&env);
    let legs = vec![&env, commitment(&env, &stranger, 1_000, 1)];

    let res = client.try_release_split(&escrow_id, &stranger, &legs);
    assert_eq!(res, Err(Ok(EscrowError::Unauthorized)));
}

#[test]
fn test_release_split_missing_escrow_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _, _, payer, _, _) = setup_funded_escrow(&env, 0, 1_000);
    let recipient = Address::generate(&env);
    let legs = vec![&env, commitment(&env, &recipient, 1_000, 1)];

    let res = client.try_release_split(&999, &payer, &legs);
    assert_eq!(res, Err(Ok(EscrowError::EscrowNotFound)));
}

#[test]
fn test_release_split_uninitialized_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _, _, payer, _, _, _, _) = setup_test_env(&env, 0);
    let recipient = Address::generate(&env);
    let legs = vec![&env, commitment(&env, &recipient, 1_000, 1)];

    let res = client.try_release_split(&1, &payer, &legs);
    assert_eq!(res, Err(Ok(EscrowError::NotInitialized)));
}

#[test]
fn test_release_split_empty_commitments_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _, _, payer, _, escrow_id) = setup_funded_escrow(&env, 0, 1_000);
    let legs: Vec<DisbursementCommitment> = Vec::new(&env);

    let res = client.try_release_split(&escrow_id, &payer, &legs);
    assert_eq!(res, Err(Ok(EscrowError::EmptyDisbursement)));
}

#[test]
fn test_release_split_max_commitments_boundary() {
    let env = Env::default();
    env.mock_all_auths();

    let max = MAX_DISBURSEMENT_COMMITMENTS as i128;

    // MAX + 1 legs is rejected.
    let (client, _, _, _, payer, _, escrow_id) = setup_funded_escrow(&env, 0, (max + 1) * 100);
    let mut too_many = Vec::new(&env);
    for i in 0..(max + 1) {
        too_many.push_back(commitment(&env, &Address::generate(&env), 100, i as u8));
    }
    let res = client.try_release_split(&escrow_id, &payer, &too_many);
    assert_eq!(res, Err(Ok(EscrowError::TooManyDisbursements)));

    // Exactly MAX legs succeeds.
    let env2 = Env::default();
    env2.mock_all_auths();
    let (client2, contract_id2, _, _, payer2, token2, escrow_id2) =
        setup_funded_escrow(&env2, 0, max * 100);
    let mut exactly_max = Vec::new(&env2);
    for i in 0..max {
        exactly_max.push_back(commitment(&env2, &Address::generate(&env2), 100, i as u8));
    }
    client2.release_split(&escrow_id2, &payer2, &exactly_max);
    assert_eq!(token2.balance(&contract_id2), 0);
}

#[test]
fn test_release_split_zero_or_negative_leg_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _, _, payer, _, escrow_id) = setup_funded_escrow(&env, 0, 1_000);
    let a = Address::generate(&env);
    let b = Address::generate(&env);

    let zero_leg = vec![
        &env,
        commitment(&env, &a, 1_000, 1),
        commitment(&env, &b, 0, 2),
    ];
    assert_eq!(
        client.try_release_split(&escrow_id, &payer, &zero_leg),
        Err(Ok(EscrowError::InvalidDisbursementAmount))
    );

    // A negative leg that "balances" an over-allocated leg must not slip through.
    let negative_leg = vec![
        &env,
        commitment(&env, &a, 1_500, 1),
        commitment(&env, &b, -500, 2),
    ];
    assert_eq!(
        client.try_release_split(&escrow_id, &payer, &negative_leg),
        Err(Ok(EscrowError::InvalidDisbursementAmount))
    );
}

#[test]
fn test_release_split_total_mismatch_rejected_and_state_untouched() {
    let env = Env::default();
    env.mock_all_auths();

    // 1% fee: 10_000 -> 100 fee, 9_900 distributable.
    let (client, contract_id, _, treasury, payer, token_client, escrow_id) =
        setup_funded_escrow(&env, 100, 10_000);
    let a = Address::generate(&env);
    let b = Address::generate(&env);

    // Under-allocation by one stroop.
    let under = vec![
        &env,
        commitment(&env, &a, 9_000, 1),
        commitment(&env, &b, 899, 2),
    ];
    assert_eq!(
        client.try_release_split(&escrow_id, &payer, &under),
        Err(Ok(EscrowError::DisbursementMismatch))
    );

    // Over-allocation by one stroop.
    let over = vec![
        &env,
        commitment(&env, &a, 9_000, 1),
        commitment(&env, &b, 901, 2),
    ];
    assert_eq!(
        client.try_release_split(&escrow_id, &payer, &over),
        Err(Ok(EscrowError::DisbursementMismatch))
    );

    // Full gross amount ignores the protocol fee and is therefore a mismatch.
    let gross = vec![&env, commitment(&env, &a, 10_000, 1)];
    assert_eq!(
        client.try_release_split(&escrow_id, &payer, &gross),
        Err(Ok(EscrowError::DisbursementMismatch))
    );

    // No funds moved, escrow still funded and still releasable.
    assert_eq!(token_client.balance(&contract_id), 10_000);
    assert_eq!(token_client.balance(&treasury), 0);
    assert_eq!(client.get_escrow(&escrow_id).status, EscrowStatus::Funded);

    let exact = vec![&env, commitment(&env, &a, 9_900, 1)];
    client.release_split(&escrow_id, &payer, &exact);
    assert_eq!(token_client.balance(&a), 9_900);
}

#[test]
fn test_release_split_sum_overflow_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _, _, payer, _, escrow_id) = setup_funded_escrow(&env, 0, 1_000);
    let a = Address::generate(&env);
    let legs = vec![
        &env,
        commitment(&env, &a, i128::MAX, 1),
        commitment(&env, &a, 1, 2),
    ];
    assert_eq!(
        client.try_release_split(&escrow_id, &payer, &legs),
        Err(Ok(EscrowError::ArithmeticOverflow))
    );
}

#[test]
fn test_release_split_terminal_state_transitions_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, admin, treasury, payer, beneficiary, anchor, token_client, _) =
        setup_test_env(&env, 30_000);
    client.init(&admin, &treasury, &0);
    let hash = BytesN::from_array(&env, &[7u8; 32]);
    let recipient = Address::generate(&env);
    let legs = vec![&env, commitment(&env, &recipient, 10_000, 1)];

    // Split -> split / release / refund all rejected.
    let id1 = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &10_000,
        &hash,
        &0,
    );
    client.release_split(&id1, &payer, &legs);
    assert_eq!(
        client.try_release_split(&id1, &payer, &legs),
        Err(Ok(EscrowError::InvalidStatus))
    );
    assert_eq!(
        client.try_release_to_anchor(&id1, &payer, &anchor),
        Err(Ok(EscrowError::InvalidStatus))
    );
    assert_eq!(client.try_refund(&id1), Err(Ok(EscrowError::InvalidStatus)));

    // Release -> split rejected.
    let id2 = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &10_000,
        &hash,
        &0,
    );
    client.release_to_anchor(&id2, &payer, &anchor);
    assert_eq!(
        client.try_release_split(&id2, &payer, &legs),
        Err(Ok(EscrowError::InvalidStatus))
    );

    // Refund -> split rejected.
    let id3 = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &10_000,
        &hash,
        &0,
    );
    client.refund(&id3);
    assert_eq!(
        client.try_release_split(&id3, &payer, &legs),
        Err(Ok(EscrowError::InvalidStatus))
    );
}

#[test]
fn test_release_split_emits_per_leg_tracking_events() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, contract_id, _, _, payer, _, escrow_id) = setup_funded_escrow(&env, 200, 10_000);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);
    let legs = vec![
        &env,
        commitment(&env, &a, 5_000, 0xA1),
        commitment(&env, &b, 3_800, 0xB2),
        commitment(&env, &c, 1_000, 0xC3),
    ];
    client.release_split(&escrow_id, &payer, &legs);

    let split_topic = Symbol::new(&env, "split_disb");
    let events = env.events().all();
    let split_events: std::vec::Vec<_> = events
        .iter()
        .filter(|e| {
            e.0 == contract_id
                && e.1.len() == 3
                && Symbol::try_from_val(&env, &e.1.get(0).unwrap()) == Ok(split_topic.clone())
        })
        .collect();
    assert_eq!(split_events.len(), 3);

    for (expected_index, event) in split_events.iter().enumerate() {
        let id: u64 = u64::try_from_val(&env, &event.1.get(1).unwrap()).unwrap();
        let index: u32 = u32::try_from_val(&env, &event.1.get(2).unwrap()).unwrap();
        let (recipient, amount, hash): (Address, i128, BytesN<32>) =
            <(Address, i128, BytesN<32>)>::try_from_val(&env, &event.2).unwrap();

        let expected = legs.get(expected_index as u32).unwrap();
        assert_eq!(id, escrow_id);
        assert_eq!(index, expected_index as u32);
        assert_eq!(recipient, expected.recipient);
        assert_eq!(amount, expected.amount);
        assert_eq!(hash, expected.commitment_hash);
    }

    // Summary event remains compatible with existing `disbursed` indexers.
    let disbursed = events
        .iter()
        .find(|e| {
            e.0 == contract_id
                && e.1.len() == 2
                && Symbol::try_from_val(&env, &e.1.get(0).unwrap())
                    == Ok(Symbol::new(&env, "disbursed"))
        })
        .expect("summary disbursed event not found");
    let (profile_hash, total): (BytesN<32>, i128) =
        <(BytesN<32>, i128)>::try_from_val(&env, &disbursed.2).unwrap();
    assert_eq!(profile_hash, BytesN::from_array(&env, &[42u8; 32]));
    assert_eq!(total, 9_800);
}

// ============================================================================
// Issue #72 — Paginated, immutable audit-trail export
// ============================================================================

/// Initializes the contract and creates `count` escrows of 100 units each.
fn setup_many_escrows(env: &Env, count: u64) -> (EscrowGateClient<'_>, Address, Address) {
    let (client, _, admin, treasury, payer, beneficiary, _, token_client, _) =
        setup_test_env(env, (count as i128) * 100);
    client.init(&admin, &treasury, &0);
    for i in 0..count {
        client.create_escrow(
            &payer,
            &beneficiary,
            &token_client.address,
            &100,
            &BytesN::from_array(env, &[(i % 256) as u8; 32]),
            &0,
        );
    }
    (client, admin, payer)
}

fn page_ids(page: &Vec<EscrowEntry>) -> std::vec::Vec<u64> {
    page.iter().map(|e| e.escrow_id).collect()
}

#[test]
fn test_paginated_uninitialized_and_empty_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, admin, treasury, _, _, _, _, _) = setup_test_env(&env, 0);
    assert_eq!(client.get_escrows_paginated(&1, &10).len(), 0);

    client.init(&admin, &treasury, &0);
    assert_eq!(client.get_escrows_paginated(&1, &10).len(), 0);
    assert_eq!(client.get_escrows_paginated(&0, &50).len(), 0);
}

#[test]
fn test_paginated_first_page_matches_get_escrow() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _) = setup_many_escrows(&env, 5);
    let page = client.get_escrows_paginated(&1, &3);
    assert_eq!(page_ids(&page), std::vec![1, 2, 3]);
    for entry in page.iter() {
        assert_eq!(entry.record, client.get_escrow(&entry.escrow_id));
    }
}

#[test]
fn test_paginated_start_zero_treated_as_first_id() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _) = setup_many_escrows(&env, 3);
    assert_eq!(
        client.get_escrows_paginated(&0, &10),
        client.get_escrows_paginated(&1, &10)
    );
    assert_eq!(
        page_ids(&client.get_escrows_paginated(&0, &10)),
        std::vec![1, 2, 3]
    );
}

#[test]
fn test_paginated_zero_limit_returns_empty() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _) = setup_many_escrows(&env, 3);
    assert_eq!(client.get_escrows_paginated(&1, &0).len(), 0);
}

#[test]
fn test_paginated_tail_and_out_of_range_boundaries() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _) = setup_many_escrows(&env, 5);
    // Page straddling the end is truncated, not padded.
    assert_eq!(
        page_ids(&client.get_escrows_paginated(&4, &10)),
        std::vec![4, 5]
    );
    // start_id == counter yields exactly the last escrow.
    assert_eq!(
        page_ids(&client.get_escrows_paginated(&5, &10)),
        std::vec![5]
    );
    // start_id beyond counter yields an empty page.
    assert_eq!(client.get_escrows_paginated(&6, &10).len(), 0);
    // Extreme inputs never panic or overflow.
    assert_eq!(client.get_escrows_paginated(&u64::MAX, &u32::MAX).len(), 0);
}

#[test]
fn test_paginated_limit_clamped_to_hard_maximum() {
    let env = Env::default();
    env.mock_all_auths();

    let total = (MAX_PAGE_SIZE as u64) + 10;
    let (client, _, _) = setup_many_escrows(&env, total);

    let page = client.get_escrows_paginated(&1, &u32::MAX);
    assert_eq!(page.len(), MAX_PAGE_SIZE);
    assert_eq!(page.first().unwrap().escrow_id, 1);
    assert_eq!(page.last().unwrap().escrow_id, MAX_PAGE_SIZE as u64);

    let exactly_max = client.get_escrows_paginated(&1, &MAX_PAGE_SIZE);
    assert_eq!(exactly_max.len(), MAX_PAGE_SIZE);

    let over_max = client.get_escrows_paginated(&1, &(MAX_PAGE_SIZE + 1));
    assert_eq!(over_max.len(), MAX_PAGE_SIZE);
}

#[test]
fn test_paginated_full_traversal_is_contiguous_and_complete() {
    let env = Env::default();
    env.mock_all_auths();

    let total = 23u64;
    let (client, _, _) = setup_many_escrows(&env, total);

    let mut seen = std::vec::Vec::new();
    let mut cursor = 1u64;
    let mut pages = 0;
    loop {
        let page = client.get_escrows_paginated(&cursor, &7);
        if page.is_empty() {
            break;
        }
        pages += 1;
        cursor = page.last().unwrap().escrow_id + 1;
        seen.extend(page_ids(&page));
    }

    assert_eq!(pages, 4); // 7 + 7 + 7 + 2
    assert_eq!(seen, (1..=total).collect::<std::vec::Vec<u64>>());
}

#[test]
fn test_paginated_reflects_lifecycle_transitions() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, payer) = setup_many_escrows(&env, 3);
    let anchor = Address::generate(&env);
    client.release_to_anchor(&1, &payer, &anchor);
    client.refund(&2);

    let page = client.get_escrows_paginated(&1, &3);
    assert_eq!(page.get(0).unwrap().record.status, EscrowStatus::Disbursed);
    assert_eq!(page.get(1).unwrap().record.status, EscrowStatus::Refunded);
    assert_eq!(page.get(2).unwrap().record.status, EscrowStatus::Funded);
}

#[test]
fn test_paginated_query_is_read_only() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _) = setup_many_escrows(&env, 2);
    let before_counter = client.get_counter();
    let before = client.get_escrows_paginated(&1, &2);

    let _ = client.get_escrows_paginated(&1, &50);
    assert_eq!(client.get_counter(), before_counter);
    assert_eq!(client.get_escrows_paginated(&1, &2), before);
    // No auth is required for the audit read path.
    let _ = client.get_escrows_paginated(&1, &2);
    assert_eq!(env.auths().len(), 0);
}

// ============================================================================
// Issue #71 — Gas profiling harness (Soroban budget metering)
// ============================================================================
//
// Every top-level contract invocation resets the host budget, so reading
// `env.cost_estimate().budget()` immediately after a client call yields the
// CPU instructions and memory bytes metered for exactly that invocation
// (including nested SAC token transfers and auth checks).
//
// Reproduce the table in `docs/gas-benchmarks.md` with:
//   cargo test gas_benchmark -- --nocapture --test-threads=1

/// Stellar mainnet per-transaction CPU instruction limit (Protocol 22).
const MAINNET_TX_MAX_CPU_INSTRUCTIONS: u64 = 100_000_000;
/// Stellar mainnet per-transaction memory limit (Protocol 22): 40 MiB.
const MAINNET_TX_MAX_MEMORY_BYTES: u64 = 41_943_040;
/// "Comfortable" headroom target: every entrypoint must stay below this share
/// of the mainnet limits even in its worst-case payload configuration, leaving
/// room for the Wasm VM instantiation overhead that native test registration
/// does not meter.
const COMFORT_MARGIN_PERCENT: u64 = 25;

struct GasSample {
    entrypoint: &'static str,
    payload: std::string::String,
    cpu: u64,
    mem: u64,
}

/// Captures the budget of the invocation that just completed and asserts it
/// fits within the mainnet limits with the required headroom.
fn record_gas(env: &Env, entrypoint: &'static str, payload: &str) -> GasSample {
    let budget = env.cost_estimate().budget();
    let sample = GasSample {
        entrypoint,
        payload: payload.into(),
        cpu: budget.cpu_instruction_cost(),
        mem: budget.memory_bytes_cost(),
    };

    assert!(sample.cpu > 0, "{entrypoint}: CPU metering returned zero");
    assert!(
        sample.mem > 0,
        "{entrypoint}: memory metering returned zero"
    );
    assert!(
        sample.cpu * 100 <= MAINNET_TX_MAX_CPU_INSTRUCTIONS * COMFORT_MARGIN_PERCENT,
        "{entrypoint} ({payload}): {} CPU instructions exceeds {COMFORT_MARGIN_PERCENT}% of mainnet limit",
        sample.cpu
    );
    assert!(
        sample.mem * 100 <= MAINNET_TX_MAX_MEMORY_BYTES * COMFORT_MARGIN_PERCENT,
        "{entrypoint} ({payload}): {} memory bytes exceeds {COMFORT_MARGIN_PERCENT}% of mainnet limit",
        sample.mem
    );
    sample
}

fn print_gas_table(title: &str, samples: &[GasSample]) {
    std::println!("\n### {title}\n");
    std::println!(
        "| Entrypoint | Payload | CPU Instructions | Memory (Bytes) | % CPU Limit | % Mem Limit |"
    );
    std::println!("| :--- | :--- | ---: | ---: | ---: | ---: |");
    for s in samples {
        std::println!(
            "| `{}` | {} | {} | {} | {:.3}% | {:.3}% |",
            s.entrypoint,
            s.payload,
            s.cpu,
            s.mem,
            (s.cpu as f64) * 100.0 / (MAINNET_TX_MAX_CPU_INSTRUCTIONS as f64),
            (s.mem as f64) * 100.0 / (MAINNET_TX_MAX_MEMORY_BYTES as f64),
        );
    }
}

#[test]
fn test_gas_benchmark_metering_resets_per_invocation() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, admin, treasury, _, _, _, _, _) = setup_test_env(&env, 0);

    client.init(&admin, &treasury, &200);
    let init_cpu = env.cost_estimate().budget().cpu_instruction_cost();

    // A trivial getter must cost far less than `init`, proving the budget is
    // scoped to the most recent invocation rather than cumulative.
    client.get_fee_bps();
    let getter_cpu = env.cost_estimate().budget().cpu_instruction_cost();
    assert!(getter_cpu > 0);
    assert!(getter_cpu < init_cpu);
}

#[test]
fn test_gas_benchmark_core_lifecycle_entrypoints() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, admin, treasury, payer, beneficiary, anchor, token_client, token_admin) =
        setup_test_env(&env, 1_000_000);
    let hash = BytesN::from_array(&env, &[9u8; 32]);
    let mut samples = std::vec::Vec::new();

    client.init(&admin, &treasury, &200);
    samples.push(record_gas(&env, "init", "fee_bps=200"));

    client.set_token_whitelist(&admin, &token_client.address, &true);
    samples.push(record_gas(&env, "set_token_whitelist", "1 token"));

    client.is_token_whitelisted(&token_client.address);
    samples.push(record_gas(&env, "is_token_whitelisted", "whitelist active"));

    let id_release = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &10_000,
        &hash,
        &100,
    );
    samples.push(record_gas(&env, "create_escrow", "whitelisted token"));

    client.release_to_anchor(&id_release, &payer, &anchor);
    samples.push(record_gas(&env, "release_to_anchor", "fee + payout"));

    let id_refund = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &10_000,
        &hash,
        &100,
    );
    env.ledger().with_mut(|l| l.timestamp += 200);
    client.refund(&id_refund);
    samples.push(record_gas(&env, "refund", "after unlock"));

    let id_dispute = client.create_escrow(
        &payer,
        &beneficiary,
        &token_client.address,
        &10_000,
        &hash,
        &100,
    );
    client.resolve_dispute(&id_dispute, &admin, &4_000, &6_000);
    samples.push(record_gas(&env, "resolve_dispute", "40/60 split"));

    client.get_escrow(&id_dispute);
    samples.push(record_gas(&env, "get_escrow", "1 record"));

    client.get_counter();
    samples.push(record_gas(&env, "get_counter", "-"));
    client.get_admin();
    samples.push(record_gas(&env, "get_admin", "-"));
    client.get_treasury();
    samples.push(record_gas(&env, "get_treasury", "-"));
    client.get_fee_bps();
    samples.push(record_gas(&env, "get_fee_bps", "-"));

    // Keep the token admin alive for the whole benchmark environment.
    let _ = token_admin;
    print_gas_table("Core lifecycle entrypoints", &samples);
}

#[test]
fn test_gas_benchmark_release_split_scaling() {
    let mut samples = std::vec::Vec::new();
    let mut previous_cpu = 0u64;

    for legs in [1u32, 2, 5, MAX_DISBURSEMENT_COMMITMENTS] {
        let env = Env::default();
        env.mock_all_auths();
        let amount = (legs as i128) * 1_000;
        let (client, _, _, _, payer, _, escrow_id) = setup_funded_escrow(&env, 0, amount);

        let mut commitments = Vec::new(&env);
        for i in 0..legs {
            commitments.push_back(commitment(&env, &Address::generate(&env), 1_000, i as u8));
        }
        client.release_split(&escrow_id, &payer, &commitments);
        let sample = record_gas(
            &env,
            "release_split",
            &std::format!("legs={legs}, fee_bps=0"),
        );

        // Cost must grow with payload size: each leg adds a transfer + event.
        assert!(
            sample.cpu > previous_cpu,
            "release_split CPU did not scale with leg count"
        );
        previous_cpu = sample.cpu;
        samples.push(sample);
    }

    // Worst case with an additional treasury fee transfer.
    let env = Env::default();
    env.mock_all_auths();
    let legs = MAX_DISBURSEMENT_COMMITMENTS;
    let (client, _, _, _, payer, _, escrow_id) = setup_funded_escrow(&env, 1_000, 100_000);
    let mut commitments = Vec::new(&env);
    for i in 0..legs {
        commitments.push_back(commitment(&env, &Address::generate(&env), 9_000, i as u8));
    }
    client.release_split(&escrow_id, &payer, &commitments);
    samples.push(record_gas(
        &env,
        "release_split",
        &std::format!("legs={legs}, fee_bps=1000 (worst case)"),
    ));

    print_gas_table("release_split payload scaling", &samples);
}

#[test]
fn test_gas_benchmark_paginated_query_scaling() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_many_escrows(&env, MAX_PAGE_SIZE as u64);
    let mut samples = std::vec::Vec::new();
    let mut previous_cpu = 0u64;

    for limit in [1u32, 10, 25, MAX_PAGE_SIZE] {
        let page = client.get_escrows_paginated(&1, &limit);
        assert_eq!(page.len(), limit);
        let sample = record_gas(
            &env,
            "get_escrows_paginated",
            &std::format!("limit={limit}"),
        );
        assert!(
            sample.cpu > previous_cpu,
            "pagination CPU did not scale with page size"
        );
        previous_cpu = sample.cpu;
        samples.push(sample);
    }

    // Oversized request is clamped, so it must cost no more than a max page.
    let max_page_cpu = previous_cpu;
    client.get_escrows_paginated(&1, &u32::MAX);
    let clamped = record_gas(
        &env,
        "get_escrows_paginated",
        "limit=u32::MAX (clamped to 50)",
    );
    assert!(clamped.cpu <= max_page_cpu + max_page_cpu / 100);
    samples.push(clamped);

    print_gas_table("get_escrows_paginated payload scaling", &samples);
}
