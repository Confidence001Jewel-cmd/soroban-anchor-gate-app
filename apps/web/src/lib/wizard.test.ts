import { test, describe } from "node:test";
import assert from "node:assert";
import { Keypair } from "@stellar/stellar-sdk";
import { initialWizardState, validateStep, wizardReducer, LAST_STEP, WizardState } from "./wizard";

const TOKEN = "CBIHLECKLMXYK6FPHSGGVYF6AHNFRHR3T5EIFIS3PFQDFKDQWNR25PHT";
const filled = (over: Partial<WizardState> = {}): WizardState => ({
  ...initialWizardState(TOKEN),
  amount: "10",
  beneficiary: Keypair.random().publicKey(),
  routingInfo: "DE89370400440532013000",
  ...over,
});

describe("wizard step validation", () => {
  test("step 0 rejects bad token, zero/invalid amount and insufficient balance", () => {
    assert.match(validateStep(filled({ token: "nope" }), 0)!, /contract address/);
    assert.match(validateStep(filled({ amount: "0" }), 0)!, /greater than zero/);
    assert.ok(validateStep(filled({ amount: "abc" }), 0));
    assert.match(validateStep(filled({ balance: 99_999_999n }), 0)!, /balance/);
  });
  test("step 0 accepts amount equal to balance and unknown balance", () => {
    assert.strictEqual(validateStep(filled({ balance: 100_000_000n }), 0), null);
    assert.strictEqual(validateStep(filled({ balance: null }), 0), null);
  });
  test("step 1 validates recipient and routing", () => {
    assert.match(validateStep(filled({ beneficiary: "x" }), 1)!, /Recipient/);
    assert.match(validateStep(filled({ routingInfo: "  " }), 1)!, /required/);
    assert.strictEqual(validateStep(filled({ beneficiary: TOKEN }), 1), null);
  });
  test("step 2 bounds the lock duration", () => {
    for (const d of ["0", "366", "1.5", ""]) assert.ok(validateStep(filled({ lockDurationDays: d }), 2), d);
    for (const d of ["1", "365"]) assert.strictEqual(validateStep(filled({ lockDurationDays: d }), 2), null);
  });
});

describe("wizard reducer transitions", () => {
  test("next is blocked while the current step is invalid", () => {
    const s = initialWizardState(TOKEN);
    assert.strictEqual(wizardReducer(s, { type: "next" }).step, 0);
  });
  test("walks forward through all steps and stops at the last", () => {
    let s = filled();
    for (let i = 0; i < LAST_STEP; i++) s = wizardReducer(s, { type: "next" });
    assert.strictEqual(s.step, LAST_STEP);
    assert.strictEqual(wizardReducer(s, { type: "next" }).step, LAST_STEP);
  });
  test("back never goes below zero and preserves data", () => {
    let s = wizardReducer(filled(), { type: "next" });
    s = wizardReducer(s, { type: "back" });
    assert.strictEqual(s.step, 0);
    assert.strictEqual(s.amount, "10");
    assert.strictEqual(wizardReducer(s, { type: "back" }).step, 0);
  });
  test("goto forward requires earlier steps valid; backward always allowed", () => {
    assert.strictEqual(wizardReducer(initialWizardState(TOKEN), { type: "goto", step: 2 }).step, 0);
    assert.strictEqual(wizardReducer(filled(), { type: "goto", step: 3 }).step, 3);
    assert.strictEqual(wizardReducer(filled({ step: 3 }), { type: "goto", step: 0 }).step, 0);
    assert.strictEqual(wizardReducer(filled(), { type: "goto", step: 9 }).step, 0);
  });
  test("set and setBalance update fields", () => {
    let s = wizardReducer(initialWizardState(TOKEN), { type: "set", field: "amount", value: "5" });
    s = wizardReducer(s, { type: "setBalance", balance: 7n });
    assert.strictEqual(s.amount, "5");
    assert.strictEqual(s.balance, 7n);
  });
});
