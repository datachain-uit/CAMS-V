const assert = require("node:assert/strict");
const { collectApprovals } = require("./vote_modules/collector");
const base = {
  deadlineMs: 90,
  seed: 2026,
  defaultTrustee: { behavior: "NORMAL", delayMs: 0, jitterMs: 0 },
  trustees: {},
};
function mockPool(times, statuses = []) {
  return times.map((delay, idx) => ({
    id: idx + 1,
    request: () =>
      new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              status: statuses[idx] || "APPROVED",
              signature: "sig" + idx,
            }),
          delay,
        ),
      ),
  }));
}
async function main() {
  let r = await collectApprovals({
    pool: mockPool([10, 25, 60]),
    packet: {},
    threshold: 2,
    config: base,
    voteIndex: 0,
  });
  assert.equal(r.status, "THRESHOLD_REACHED");
  assert.equal(r.signatures.length, 2);
  r = await collectApprovals({
    pool: mockPool([10, 20, 30], ["REFUSED", "APPROVED", "REFUSED"]),
    packet: {},
    threshold: 2,
    config: base,
    voteIndex: 0,
  });
  assert.equal(r.status, "INSUFFICIENT_APPROVALS");
  r = await collectApprovals({
    pool: mockPool([10, 200, 200]),
    packet: {},
    threshold: 2,
    config: base,
    voteIndex: 0,
  });
  assert.equal(r.status, "TIMEOUT");
  assert.equal(r.timeToThresholdMs, null);
  console.log(
    "Collector smoke tests: PASS (threshold / insufficient / deadline)",
  );
}
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
