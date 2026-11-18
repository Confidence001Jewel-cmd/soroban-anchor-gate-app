import { StrKey } from "@stellar/stellar-sdk";
import { parseTokenAmount } from "./crypto";

export const WIZARD_STEPS = ["Token & Amount", "Recipient", "Timeout & Arbiter", "Review & Sign"] as const;
export const LAST_STEP = WIZARD_STEPS.length - 1;

export interface WizardState {
  step: number;
  token: string;
  amount: string;
  /** Payer balance in base units, or null when unknown. */
  balance: bigint | null;
  beneficiary: string;
  routingInfo: string;
  lockDurationDays: string;
  /** Advisory only: disputes are resolved on-chain by the protocol admin. */
  arbiter: "protocol-admin";
}

export type WizardAction =
  | { type: "set"; field: "token" | "amount" | "beneficiary" | "routingInfo" | "lockDurationDays"; value: string }
  | { type: "setBalance"; balance: bigint | null }
  | { type: "next" }
  | { type: "back" }
  | { type: "goto"; step: number };

export function initialWizardState(token: string): WizardState {
  return {
    step: 0,
    token,
    amount: "",
    balance: null,
    beneficiary: "",
    routingInfo: "",
    lockDurationDays: "7",
    arbiter: "protocol-admin",
  };
}

/** Returns an error message for the given step, or null when it is valid. */
export function validateStep(state: WizardState, step: number): string | null {
  try {
    if (step === 0) {
      if (!StrKey.isValidContract(state.token)) return "Token must be a valid C... contract address";
      const base = parseTokenAmount(state.amount, 7);
      if (base <= 0n) return "Amount must be greater than zero";
      if (state.balance !== null && base > state.balance) return "Amount exceeds your available balance";
    } else if (step === 1) {
      const b = state.beneficiary;
      if (!StrKey.isValidEd25519PublicKey(b) && !StrKey.isValidContract(b)) {
        return "Recipient must be a valid Stellar public key or contract address";
      }
      if (state.routingInfo.trim() === "") return "Bank IBAN / routing details are required";
    } else if (step === 2) {
      const days = Number(state.lockDurationDays);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        return "Lock duration must be a whole number of days between 1 and 365";
      }
    }
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return null;
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "set":
      return { ...state, [action.field]: action.value };
    case "setBalance":
      return { ...state, balance: action.balance };
    case "next":
      if (state.step >= LAST_STEP || validateStep(state, state.step) !== null) return state;
      return { ...state, step: state.step + 1 };
    case "back":
      return state.step > 0 ? { ...state, step: state.step - 1 } : state;
    case "goto": {
      // Jumping forward requires every earlier step to be valid.
      if (action.step < 0 || action.step > LAST_STEP) return state;
      for (let s = 0; s < action.step; s++) if (validateStep(state, s) !== null) return state;
      return { ...state, step: action.step };
    }
  }
}
