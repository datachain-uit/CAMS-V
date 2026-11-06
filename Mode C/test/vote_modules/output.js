const fs = require("fs");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function createVoteWriter(filePath, batchSize = 1000) {
  const stream = fs.createWriteStream(filePath, { flags: "w" });
  let buffer = [];
  let isFirstVote = true;

  stream.write("[\n");

  function flush() {
    if (buffer.length === 0) return;

    let chunk = "";
    for (const vote of buffer) {
      if (!isFirstVote) chunk += ",\n";
      chunk += JSON.stringify(vote, null, 2);
      isFirstVote = false;
    }

    stream.write(chunk);
    buffer = [];
  }

  return {
    addVote(vote) {
      buffer.push(vote);
      if (buffer.length >= batchSize) flush();
    },

    async close() {
      flush();
      await new Promise((resolve, reject) => {
        stream.on("error", reject);
        stream.end("\n]\n", resolve);
      });
    },
  };
}

function resetCSV(csvFile) {
  fs.writeFileSync(
    csvFile,
    "voter,mode,gasUsed,endToEndTimeMs,witnessTimeMs,proofGenerationTimeMs,resultCode\n",
    "utf8",
  );
}

function appendCSVData(data, csvFile) {
  const row =
    [
      data.voter,
      data.mode,
      data.gasUsed,
      data.endToEndTimeMs,
      data.witnessTimeMs,
      data.proofGenerationTimeMs,
      data.resultCode,
    ].join(",") + "\n";

  fs.appendFileSync(csvFile, row, "utf8");
}

module.exports = { ensureDir, createVoteWriter, resetCSV, appendCSVData };
