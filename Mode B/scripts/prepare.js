const fs = require("fs");
const path = require("path");

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

function computeDepth(numVoters) {
  return Math.ceil(Math.log2(numVoters));
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    fail(`Cannot read file: ${filePath}\n${error.message}`);
  }
}

function writeFileSafe(filePath, content) {
  try {
    fs.writeFileSync(filePath, content, "utf8");
  } catch (error) {
    fail(`Cannot write file: ${filePath}\n${error.message}`);
  }
}

function replaceOrFail(content, pattern, replacement, label) {
  if (!pattern.test(content)) {
    fail(`Cannot find the target pattern in ${label}`);
  }
  return content.replace(pattern, replacement);
}

function findFirstExisting(rootDir, relativeCandidates) {
  for (const relativePath of relativeCandidates) {
    const absolutePath = path.join(rootDir, relativePath);
    if (fs.existsSync(absolutePath)) {
      return absolutePath;
    }
  }

  fail(
    `Cannot find any file in the following paths:\n- ${relativeCandidates.join(
      "\n- ",
    )}`,
  );
}

function updateFile(filePath, updater) {
  const before = readFileSafe(filePath);
  const after = updater(before);
  writeFileSafe(filePath, after);
}

function main() {
  const [, , voterArg, candidateArg, selectionArg] = process.argv;

  const numVoters = Number.parseInt(voterArg, 10);
  const numCandidates = Number.parseInt(candidateArg, 10);
  const numSelections = Number.parseInt(selectionArg, 10);

  if (!isPositiveInt(numVoters)) {
    fail(
      "The number of voters must be a positive integer. Example: node scripts/prepare.js 1000 5 1",
    );
  }

  if (!isPositiveInt(numCandidates)) {
    fail(
      "The number of candidates must be a positive integer. Example: node scripts/prepare.js 1000 5 1",
    );
  }

  if (!isPositiveInt(numSelections)) {
    fail(
      "The number of selections must be a positive integer. Example: node scripts/prepare.js 1000 5 1",
    );
  }

  if (numVoters < 2) {
    fail(
      "At least 2 voters are recommended for stable Merkle depth computation.",
    );
  }

  if (numSelections > numCandidates) {
    fail(
      "The number of selections cannot be greater than the number of candidates.",
    );
  }

  const depth = computeDepth(numVoters);
  const projectRoot =
    path.basename(__dirname) === "scripts"
      ? path.resolve(__dirname, "..")
      : path.resolve(__dirname, ".");

  const files = {
    voteProofCombined: findFirstExisting(projectRoot, [
      "circuits/VoteProofCombined.circom",
      "VoteProofCombined.circom",
    ]),
    tallyValidity: findFirstExisting(projectRoot, [
      "circuits/TallyValidity.circom",
      "TallyValidity.circom",
    ]),
    genVoter: findFirstExisting(projectRoot, [
      "scripts/gen_voter.js",
      "gen_voter.js",
    ]),
    prepareVoters: findFirstExisting(projectRoot, [
      "scripts/prepare_voters.js",
      "prepare_voters.js",
    ]),
    register: findFirstExisting(projectRoot, [
      "test/register.js",
      "scripts/register.js",
      "register.js",
    ]),
    vote: findFirstExisting(projectRoot, [
      "test/vote.js",
      "scripts/vote.js",
      "vote.js",
    ]),
  };

  updateFile(files.voteProofCombined, (content) =>
    replaceOrFail(
      content,
      /component\s+main\s*=\s*VotingCircuit\(\s*\d+\s*,\s*\d+\s*\)\s*;/,
      `component main = VotingCircuit(${depth}, ${numCandidates});`,
      files.voteProofCombined,
    ),
  );

  updateFile(files.tallyValidity, (content) =>
    replaceOrFail(
      content,
      /component\s+main\s*=\s*BatchTallyValidity\(\s*(\d+)\s*,\s*\d+\s*\)\s*;/,
      `component main = BatchTallyValidity($1, ${numCandidates});`,
      files.tallyValidity,
    ),
  );

  updateFile(files.genVoter, (content) =>
    replaceOrFail(
      content,
      /const\s+NUM_VOTERS_TO_GENERATE\s*=\s*\d+\s*;/,
      `const NUM_VOTERS_TO_GENERATE = ${numVoters};`,
      files.genVoter,
    ),
  );

  updateFile(files.prepareVoters, (content) =>
    replaceOrFail(
      content,
      /voter_data_for_db_\d+\.json/g,
      `voter_data_for_db_${numVoters}.json`,
      files.prepareVoters,
    ),
  );

  updateFile(files.register, (content) => {
    let next = content;

    next = replaceOrFail(
      next,
      /voter_data_for_db_\d+\.json/g,
      `voter_data_for_db_${numVoters}.json`,
      `${files.register} (voter db)`,
    );

    next = replaceOrFail(
      next,
      /const\s+NUM_CANDIDATES\s*=\s*\d+\s*;/,
      `const NUM_CANDIDATES = ${numCandidates};`,
      `${files.register} (NUM_CANDIDATES)`,
    );

    return next;
  });

  updateFile(files.vote, (content) => {
    let next = content;

    next = replaceOrFail(
      next,
      /voter_data_for_db_\d+\.json/g,
      `voter_data_for_db_${numVoters}.json`,
      `${files.vote} (voter db)`,
    );

    next = replaceOrFail(
      next,
      /voter_secrets_for_script_\d+\.json/g,
      `voter_secrets_for_script_${numVoters}.json`,
      `${files.vote} (voter secrets)`,
    );

    next = replaceOrFail(
      next,
      /const\s+NUM_CANDIDATES\s*=\s*\d+\s*;/,
      `const NUM_CANDIDATES = ${numCandidates};`,
      `${files.vote} (NUM_CANDIDATES)`,
    );

    next = replaceOrFail(
      next,
      /const\s+NUM_SELECTIONS\s*=\s*\d+\s*;/,
      `const NUM_SELECTIONS = ${numSelections};`,
      `${files.vote} (NUM_SELECTIONS)`,
    );

    return next;
  });

  console.log("Prepare completed");
  console.log(`- numVoters     : ${numVoters}`);
  console.log(`- numCandidates : ${numCandidates}`);
  console.log(`- numSelections : ${numSelections}`);
  console.log(`- merkleDepth   : ${depth}`);
  console.log("");
  console.log("Updated files:");
  console.log(`- ${files.voteProofCombined}`);
  console.log(`- ${files.tallyValidity}`);
  console.log(`- ${files.genVoter}`);
  console.log(`- ${files.prepareVoters}`);
  console.log(`- ${files.register}`);
  console.log(`- ${files.vote}`);
}

main();
