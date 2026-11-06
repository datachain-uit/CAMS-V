"use strict";
const fs = require("fs");

// Keep the CSV schema unchanged. Per-trustee timings live inside trusteeDetails JSON.
const COLUMNS = [
  "scenarioId",
  "voteIndex",
  "voter",
  "collectionMode",
  "threshold",
  "totalTrustees",
  "deadlineMs",
  "status",
  "resultCode",
  "gasUsed",
  "timeToThresholdMs",
  "approvalElapsedMs",
  "endToEndTimeMs",
  "witnessTimeMs",
  "proofGenerationTimeMs",
  "ipfsTimeMs",
  "onchainTimeMs",
  "error",
  "trusteeDetails",
];
function prepareExperimentOutput(filename) {
  fs.writeFileSync(filename, COLUMNS.join(",") + "\n");
}
function escapeCsv(v) {
  const str =
    v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}
function writeExperimentRow(filename, fields) {
  fs.appendFileSync(
    filename,
    COLUMNS.map((c) => escapeCsv(fields[c])).join(",") + "\n",
  );
}
module.exports = { prepareExperimentOutput, writeExperimentRow };
