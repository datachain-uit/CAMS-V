"use strict";

const { performance } = require("perf_hooks");

const VALID_BEHAVIORS = new Set(["NORMAL", "SLOW", "OFFLINE", "REFUSE"]);

function deterministicJitter(seed, voteIndex, trusteeId, range) {
  if (!range) return 0;

  let h =
    (Number(seed) ^
      Math.imul(voteIndex + 1, 2654435761) ^
      Math.imul(trusteeId, 2246822519)) >>>
    0;

  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;

  return (h >>> 0) % (range + 1);
}

function behaviorFor(config, trusteeId, voteIndex) {
  const profile = {
    ...config.defaultTrustee,
    ...(config.trustees[trusteeId] || {}),
  };

  if (!VALID_BEHAVIORS.has(profile.behavior)) {
    throw new Error(
      `Invalid behavior for trustee ${trusteeId}: ${profile.behavior}`,
    );
  }

  for (const name of ["delayMs", "jitterMs"]) {
    if (!Number.isInteger(profile[name] || 0) || (profile[name] || 0) < 0) {
      throw new Error(`Invalid ${name} for trustee ${trusteeId}`);
    }
  }

  profile.delayMs =
    (profile.delayMs || 0) +
    deterministicJitter(
      config.seed,
      voteIndex,
      trusteeId,
      profile.jitterMs || 0,
    );

  return profile;
}

/**
 * Collect the first t distinct trustee approvals.
 *
 * The result is returned as soon as the threshold
 * is reached (or the operation fails).
 *
 * result.drained resolves when ALL dispatched
 * trustee requests have settled.
 *
 * IMPORTANT:
 * Await result.drained only AFTER OAL is recorded.
 */
function collectApprovals({ pool, packet, threshold, config, voteIndex }) {
  if (
    !Number.isInteger(threshold) ||
    threshold < 1 ||
    threshold > pool.length
  ) {
    throw new Error("Invalid threshold");
  }

  if (!Number.isFinite(config.deadlineMs) || config.deadlineMs <= 0) {
    throw new Error("Invalid deadlineMs");
  }

  const profiles = pool.map((worker) =>
    behaviorFor(config, worker.id, voteIndex),
  );

  const started = performance.now();
  const deadline = started + config.deadlineMs;

  const details = [];
  const approvals = new Map();

  let resolved = 0;
  let remaining = pool.length;
  let markDrained;

  // Separate lifecycle barrier.
  const drained = new Promise((resolve) => {
    markDrained = resolve;
  });

  return new Promise((resolve) => {
    let closed = false;

    const timer = setTimeout(() => finish("TIMEOUT"), config.deadlineMs);

    function finish(status) {
      if (closed) return;

      closed = true;
      clearTimeout(timer);

      const elapsed = performance.now() - started;

      resolve({
        status,
        signatures: [...approvals.values()],
        timeToThresholdMs: status === "THRESHOLD_REACHED" ? elapsed : null,
        approvalElapsedMs: elapsed,

        // Snapshot so late responses do not alter
        // the experimental CSV of this ballot.
        details: details.map((d) => ({ ...d })),

        // Not written to CSV.
        drained,
      });
    }

    function completed() {
      remaining--;

      if (remaining === 0) {
        markDrained();
      }
    }

    function checkInsufficient() {
      if (!closed && approvals.size + pool.length - resolved < threshold) {
        finish("INSUFFICIENT_APPROVALS");
      }
    }

    for (let i = 0; i < pool.length; i++) {
      const worker = pool[i];
      const profile = profiles[i];

      const requestedAtMs = performance.now() - started;

      // Simulated OFFLINE: do not send a request.
      // Otherwise worker_pool.js would retain
      // a promise that never settles.
      if (profile.behavior === "OFFLINE") {
        resolved++;

        details.push({
          trusteeId: worker.id,
          status: "NO_RESPONSE",
          requestedAtMs: null,
          respondedAtMs: null,
          verifyTimeMs: null,
          digestTimeMs: null,
          signTimeMs: null,
          processingTimeMs: null,
          error: "Simulated offline",
        });

        completed();
        checkInsufficient();
        continue;
      }

      worker
        .request({ packet, profile })
        .then((response) => {
          const receivedAt = performance.now();
          resolved++;

          const status = response.status || "ERROR";

          if (!closed && receivedAt <= deadline) {
            details.push({
              trusteeId: worker.id,
              status,
              requestedAtMs,
              respondedAtMs: receivedAt - started,
              verifyTimeMs: response.verifyTimeMs ?? null,
              digestTimeMs: response.digestTimeMs ?? null,
              signTimeMs: response.signTimeMs ?? null,
              processingTimeMs: response.processingTimeMs ?? null,
              error: response.error || "",
            });

            if (status === "APPROVED" && response.signature) {
              approvals.set(worker.id, response.signature);
            }

            if (approvals.size >= threshold) {
              finish("THRESHOLD_REACHED");
            } else {
              checkInsufficient();
            }
          }
        })
        .catch((err) => {
          resolved++;

          if (!closed) {
            details.push({
              trusteeId: worker.id,
              status: "ERROR",
              requestedAtMs,
              respondedAtMs: performance.now() - started,
              verifyTimeMs: null,
              digestTimeMs: null,
              signTimeMs: null,
              processingTimeMs: null,
              error: err.message,
            });

            checkInsufficient();
          }
        })
        .finally(completed);
    }
  });
}

module.exports = {
  collectApprovals,
  behaviorFor,
};
