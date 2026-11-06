function createVoteSubmitter(votingContract) {
  const seen = new Set();

  return async function submitVoteWithThreshold(packet, signatures) {
    const key = `${packet.votePayload.nullifier}`;
    if (seen.has(key)) {
      return { code: 2, gasUsed: 0n };
    }

    const tx = await votingContract.submitVoteWithTrusteeSignatures(
      packet.votePayload.nullifier,
      packet.votePayload.hashCipherAll,
      packet.votePayload.cid,
      signatures,
    );

    const receipt = await tx.wait();
    seen.add(key);

    return {
      code: 0,
      gasUsed: receipt.gasUsed ?? 0n,
    };
  };
}

module.exports = { createVoteSubmitter };
