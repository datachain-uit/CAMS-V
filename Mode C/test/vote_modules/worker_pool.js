"use strict";
const { fork } = require("child_process");
const path = require("path");

async function startWorkerPool({
  count,
  startupTimeoutMs = 20000,
  workerScript = path.join(__dirname, "..", "trustee_worker.js"),
}) {
  if (!Number.isInteger(count) || count < 1)
    throw new Error("count must be positive integer");
  const pool = [];
  try {
    for (let id = 1; id <= count; id++) {
      const child = fork(workerScript, [], {
        cwd: process.cwd(),
        env: { ...process.env, TRUSTEE_ID: String(id) },
        stdio: ["inherit", "inherit", "inherit", "ipc"],
      });
      console.log(
        `[CA PID ${process.pid}] Started Trustee ${id} - PID ${child.pid}`,
      );

      const pending = new Map();
      let sequence = 0,
        ready = false,
        dead = false;
      let startupResolve, startupReject;
      const startup = new Promise((resolve, reject) => {
        startupResolve = resolve;
        startupReject = reject;
      });
      const readyTimer = setTimeout(
        () => startupReject(new Error(`Trustee ${id} startup timeout`)),
        startupTimeoutMs,
      );
      function failAll(error) {
        if (dead) return;
        dead = true;
        clearTimeout(readyTimer);
        if (!ready) startupReject(error);
        for (const p of pending.values()) p.reject(error);
        pending.clear();
      }
      child.on("message", (message) => {
        if (message.type === "READY") {
          ready = true;
          clearTimeout(readyTimer);
          startupResolve();
          return;
        }
        if (message.type === "STARTUP_ERROR") {
          failAll(new Error(message.error));
          return;
        }
        if (message.type === "RESPONSE") {
          const p = pending.get(message.requestId);
          if (p) {
            pending.delete(message.requestId);
            p.resolve(message.result);
          }
        }
      });
      child.on("error", (err) => failAll(err));
      child.on("exit", (code, signal) =>
        failAll(new Error(`Trustee ${id} exited: ${code ?? signal}`)),
      );
      const worker = {
        id,
        child,
        startup,
        request(payload) {
          if (dead || !child.connected)
            return Promise.reject(new Error(`Trustee ${id} unavailable`));
          const requestId = `${id}-${++sequence}`;
          return new Promise((resolve, reject) => {
            pending.set(requestId, { resolve, reject });
            child.send({ type: "REQUEST", requestId, ...payload }, (err) => {
              if (err) {
                pending.delete(requestId);
                reject(err);
              }
            });
          });
        },
        stop() {
          if (child.connected) child.disconnect();
          child.kill();
        },
      };
      pool.push(worker);
    }
    await Promise.all(pool.map((w) => w.startup));
    return pool;
  } catch (error) {
    for (const w of pool) w.stop();
    throw error;
  }
}
module.exports = { startWorkerPool };
