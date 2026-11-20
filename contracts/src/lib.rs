#![no_std]

mod errors;
mod types;

#[cfg(test)]
mod test;

use crate::errors::EscrowError;
use crate::types::{DataKey, DisbursementCommitment, EscrowEntry, EscrowRecord, EscrowStatus};
use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, BytesN, Env, Symbol, Vec};

const BPS_DIVISOR: i128 = 10_000;
const PERSISTENT_EXTEND_TTL_THRESHOLD: u32 = 100_000;
const PERSISTENT_EXTEND_TTL_AMOUNT: u32 = 200_000;
const INSTANCE_EXTEND_TTL_THRESHOLD: u32 = 100_000;
const INSTANCE_EXTEND_TTL_AMOUNT: u32 = 200_000;

/// Upper bound on the number of legs accepted by `release_split`. Each leg costs
/// one token transfer plus one event, so the cap keeps the worst-case
/// invocation far below the per-transaction CPU/memory/event limits.
pub const MAX_DISBURSEMENT_COMMITMENTS: u32 = 10;

/// Hard ceiling on the page size served by `get_escrows_paginated`. Requests
/// for larger pages are clamped, protecting the read path from gas exhaustion.
pub const MAX_PAGE_SIZE: u32 = 50;

#[contract]
pub struct EscrowGate;

#[contractimpl]
impl EscrowGate {
    pub fn init(
        env: Env,
        admin: Address,
        treasury: Address,
        fee_bps: u32,
    ) -> Result<(), EscrowError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(EscrowError::AlreadyInitialized);
        }
        if fee_bps > 1000 {
            return Err(EscrowError::InvalidBps);
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
        env.storage().instance().set(&DataKey::EscrowCounter, &0u64);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_EXTEND_TTL_THRESHOLD, INSTANCE_EXTEND_TTL_AMOUNT);

        Ok(())
    }

    pub fn create_escrow(
        env: Env,
        payer: Address,
        beneficiary: Address,
        token: Address,
        amount: i128,
        profile_hash: BytesN<32>,
        lock_duration: u64,
    ) -> Result<u64, EscrowError> {
        payer.require_auth();

        if amount <= 0 {
            return Err(EscrowError::ZeroAmount);
        }

        if !Self::is_token_whitelisted(env.clone(), token.clone()) {
            return Err(EscrowError::TokenNotWhitelisted);
        }

        let mut counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::EscrowCounter)
            .ok_or(EscrowError::NotInitialized)?;

        counter = counter
            .checked_add(1)
            .ok_or(EscrowError::ArithmeticOverflow)?;

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&payer, &env.current_contract_address(), &amount);

        let current_time = env.ledger().timestamp();
        let unlock_timestamp = current_time
            .checked_add(lock_duration)
            .ok_or(EscrowError::ArithmeticOverflow)?;

        let record = EscrowRecord {
            payer: payer.clone(),
            beneficiary,
            token,
            amount,
            profile_hash: profile_hash.clone(),
            status: EscrowStatus::Funded,
            unlock_timestamp,
        };

        let key = DataKey::Escrow(counter);
        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_EXTEND_TTL_THRESHOLD,
            PERSISTENT_EXTEND_TTL_AMOUNT,
        );

        env.storage()
            .instance()
            .set(&DataKey::EscrowCounter, &counter);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_EXTEND_TTL_THRESHOLD, INSTANCE_EXTEND_TTL_AMOUNT);

        env.events().publish(
            (symbol_short!("created"), counter),
            (payer, amount, profile_hash),
        );

        Ok(counter)
    }

    pub fn release_to_anchor(
        env: Env,
        escrow_id: u64,
        caller: Address,
        anchor_disbursement_address: Address,
    ) -> Result<(), EscrowError> {
        caller.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(EscrowError::NotInitialized)?;

        let key = DataKey::Escrow(escrow_id);
        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::EscrowNotFound)?;

        if caller != record.payer && caller != admin {
            return Err(EscrowError::Unauthorized);
        }

        if record.status != EscrowStatus::Funded {
            return Err(EscrowError::InvalidStatus);
        }

        let fee_bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0);
        let treasury: Address = env
            .storage()
            .instance()
            .get(&DataKey::Treasury)
            .ok_or(EscrowError::NotInitialized)?;

        let fee_amount = record
            .amount
            .checked_mul(fee_bps as i128)
            .ok_or(EscrowError::ArithmeticOverflow)?
            / BPS_DIVISOR;
        let payout_amount = record
            .amount
            .checked_sub(fee_amount)
            .ok_or(EscrowError::ArithmeticOverflow)?;

        let token_client = token::Client::new(&env, &record.token);

        if fee_amount > 0 {
            token_client.transfer(&env.current_contract_address(), &treasury, &fee_amount);
        }

        token_client.transfer(
            &env.current_contract_address(),
            &anchor_disbursement_address,
            &payout_amount,
        );

        record.status = EscrowStatus::Disbursed;
        env.storage().persistent().set(&key, &record);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_EXTEND_TTL_THRESHOLD, INSTANCE_EXTEND_TTL_AMOUNT);

        env.events().publish(
            (Symbol::new(&env, "disbursed"), escrow_id),
            (record.profile_hash, payout_amount),
        );

        Ok(())
    }

    /// Disburses a funded escrow across multiple bank-account commitments.
    ///
    /// The protocol treasury fee (`fee_bps`) is deducted first, exactly as in
    /// `release_to_anchor`. The remaining distributable balance must then be
    /// covered *exactly* by the supplied commitments: the sum of all
    /// `commitment.amount` values must equal `escrow.amount - fee`. Any
    /// mismatch (under- or over-allocation) is rejected so funds can never be
    /// stranded in, or over-drawn from, the contract.
    ///
    /// Emits one `split_disb` event per leg, keyed by `(escrow_id, leg_index)`
    /// with payload `(recipient, amount, commitment_hash)`, followed by a
    /// summary `disbursed` event carrying `(profile_hash, total_payout)` so
    /// existing indexers that only track `disbursed` keep working.
    pub fn release_split(
        env: Env,
        escrow_id: u64,
        caller: Address,
        commitments: Vec<DisbursementCommitment>,
    ) -> Result<(), EscrowError> {
        caller.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(EscrowError::NotInitialized)?;

        let key = DataKey::Escrow(escrow_id);
        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::EscrowNotFound)?;

        if caller != record.payer && caller != admin {
            return Err(EscrowError::Unauthorized);
        }

        if record.status != EscrowStatus::Funded {
            return Err(EscrowError::InvalidStatus);
        }

        let leg_count = commitments.len();
        if leg_count == 0 {
            return Err(EscrowError::EmptyDisbursement);
        }
        if leg_count > MAX_DISBURSEMENT_COMMITMENTS {
            return Err(EscrowError::TooManyDisbursements);
        }

        let fee_bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0);
        let treasury: Address = env
            .storage()
            .instance()
            .get(&DataKey::Treasury)
            .ok_or(EscrowError::NotInitialized)?;

        let fee_amount = record
            .amount
            .checked_mul(fee_bps as i128)
            .ok_or(EscrowError::ArithmeticOverflow)?
            / BPS_DIVISOR;
        let distributable = record
            .amount
            .checked_sub(fee_amount)
            .ok_or(EscrowError::ArithmeticOverflow)?;

        // Validate every leg and the aggregate before moving any funds.
        let mut total: i128 = 0;
        for commitment in commitments.iter() {
            if commitment.amount <= 0 {
                return Err(EscrowError::InvalidDisbursementAmount);
            }
            total = total
                .checked_add(commitment.amount)
                .ok_or(EscrowError::ArithmeticOverflow)?;
        }
        if total != distributable {
            return Err(EscrowError::DisbursementMismatch);
        }

        // Effects before interactions: mark the escrow terminal first.
        record.status = EscrowStatus::Disbursed;
        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_EXTEND_TTL_THRESHOLD,
            PERSISTENT_EXTEND_TTL_AMOUNT,
        );
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_EXTEND_TTL_THRESHOLD, INSTANCE_EXTEND_TTL_AMOUNT);

        let token_client = token::Client::new(&env, &record.token);
        let contract_address = env.current_contract_address();

        if fee_amount > 0 {
            token_client.transfer(&contract_address, &treasury, &fee_amount);
        }

        let split_topic = Symbol::new(&env, "split_disb");
        for (index, commitment) in commitments.iter().enumerate() {
            token_client.transfer(&contract_address, &commitment.recipient, &commitment.amount);
            env.events().publish(
                (split_topic.clone(), escrow_id, index as u32),
                (
                    commitment.recipient,
                    commitment.amount,
                    commitment.commitment_hash,
                ),
            );
        }

        env.events().publish(
            (Symbol::new(&env, "disbursed"), escrow_id),
            (record.profile_hash, distributable),
        );

        Ok(())
    }

    pub fn refund(env: Env, escrow_id: u64) -> Result<(), EscrowError> {
        let key = DataKey::Escrow(escrow_id);
        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::EscrowNotFound)?;

        record.payer.require_auth();

        if record.status != EscrowStatus::Funded {
            return Err(EscrowError::InvalidStatus);
        }

        if env.ledger().timestamp() < record.unlock_timestamp {
            return Err(EscrowError::UnlockTimeNotReached);
        }

        let token_client = token::Client::new(&env, &record.token);
        token_client.transfer(
            &env.current_contract_address(),
            &record.payer,
            &record.amount,
        );

        record.status = EscrowStatus::Refunded;
        env.storage().persistent().set(&key, &record);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_EXTEND_TTL_THRESHOLD, INSTANCE_EXTEND_TTL_AMOUNT);

        env.events()
            .publish((Symbol::new(&env, "refunded"), escrow_id), record.amount);

        Ok(())
    }

    pub fn set_token_whitelist(
        env: Env,
        caller: Address,
        token: Address,
        whitelisted: bool,
    ) -> Result<(), EscrowError> {
        caller.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(EscrowError::NotInitialized)?;

        if caller != admin {
            return Err(EscrowError::Unauthorized);
        }

        env.storage()
            .instance()
            .set(&DataKey::TokenWhitelisted(token.clone()), &whitelisted);
        env.storage()
            .instance()
            .set(&DataKey::WhitelistActive, &true);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_EXTEND_TTL_THRESHOLD, INSTANCE_EXTEND_TTL_AMOUNT);

        env.events()
            .publish((Symbol::new(&env, "whitelist"), token), whitelisted);

        Ok(())
    }

    pub fn is_token_whitelisted(env: Env, token: Address) -> bool {
        let is_active: bool = env
            .storage()
            .instance()
            .get(&DataKey::WhitelistActive)
            .unwrap_or(false);

        if !is_active {
            return true;
        }

        env.storage()
            .instance()
            .get(&DataKey::TokenWhitelisted(token))
            .unwrap_or(false)
    }

    pub fn resolve_dispute(
        env: Env,
        escrow_id: u64,
        caller: Address,
        payer_bps: u32,
        beneficiary_bps: u32,
    ) -> Result<(), EscrowError> {
        caller.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(EscrowError::NotInitialized)?;

        if caller != admin {
            return Err(EscrowError::Unauthorized);
        }

        if (payer_bps as u64) + (beneficiary_bps as u64) != (BPS_DIVISOR as u64) {
            return Err(EscrowError::InvalidDisputeSplit);
        }

        let key = DataKey::Escrow(escrow_id);
        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::EscrowNotFound)?;

        if record.status != EscrowStatus::Funded {
            return Err(EscrowError::InvalidStatus);
        }

        let payer_amount = record
            .amount
            .checked_mul(payer_bps as i128)
            .ok_or(EscrowError::ArithmeticOverflow)?
            / BPS_DIVISOR;

        let beneficiary_amount = record
            .amount
            .checked_sub(payer_amount)
            .ok_or(EscrowError::ArithmeticOverflow)?;

        let token_client = token::Client::new(&env, &record.token);

        if payer_amount > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &record.payer,
                &payer_amount,
            );
        }

        if beneficiary_amount > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &record.beneficiary,
                &beneficiary_amount,
            );
        }

        record.status = EscrowStatus::Disputed;
        env.storage().persistent().set(&key, &record);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_EXTEND_TTL_THRESHOLD, INSTANCE_EXTEND_TTL_AMOUNT);

        env.events().publish(
            (Symbol::new(&env, "dispute_resolved"), escrow_id),
            (payer_amount, beneficiary_amount),
        );

        Ok(())
    }

    pub fn get_escrow(env: Env, escrow_id: u64) -> Result<EscrowRecord, EscrowError> {
        let key = DataKey::Escrow(escrow_id);
        env.storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::EscrowNotFound)
    }

    /// Paginated, read-only audit export of escrow records.
    ///
    /// Returns up to `limit` consecutive escrows starting at `start_id`
    /// (inclusive). Escrow IDs are 1-based, so `start_id = 0` is treated as
    /// `1`. `limit` is clamped to [`MAX_PAGE_SIZE`] to bound the read cost of a
    /// single call; `limit = 0` or a `start_id` beyond the current counter
    /// yields an empty page. Callers advance by passing
    /// `last_entry.escrow_id + 1` as the next `start_id`.
    pub fn get_escrows_paginated(env: Env, start_id: u64, limit: u32) -> Vec<EscrowEntry> {
        let mut page: Vec<EscrowEntry> = Vec::new(&env);

        let counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::EscrowCounter)
            .unwrap_or(0);

        let effective_limit = limit.min(MAX_PAGE_SIZE) as u64;
        let first = start_id.max(1);
        if effective_limit == 0 || first > counter {
            return page;
        }

        // `first <= counter` and `effective_limit >= 1`, so `first - 1 + limit`
        // only saturates when the counter itself is near u64::MAX.
        let last = (first - 1).saturating_add(effective_limit).min(counter);

        for escrow_id in first..=last {
            if let Some(record) = env
                .storage()
                .persistent()
                .get::<DataKey, EscrowRecord>(&DataKey::Escrow(escrow_id))
            {
                page.push_back(EscrowEntry { escrow_id, record });
            }
        }

        page
    }

    pub fn get_counter(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::EscrowCounter)
            .unwrap_or(0)
    }

    pub fn get_admin(env: Env) -> Result<Address, EscrowError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(EscrowError::NotInitialized)
    }

    pub fn get_treasury(env: Env) -> Result<Address, EscrowError> {
        env.storage()
            .instance()
            .get(&DataKey::Treasury)
            .ok_or(EscrowError::NotInitialized)
    }

    pub fn get_fee_bps(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0)
    }
}
