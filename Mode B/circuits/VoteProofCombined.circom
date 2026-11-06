pragma circom 2.1.5;

include "./VoterValidity.circom";
include "./CiphertextValidity.circom";
include "circomlib/circuits/poseidon.circom";

template VotingCircuit(depth, nCandidates) {
    signal input sk;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal input root;
    signal input hash_pk;
    signal input election_hash;

    signal input PKx;
    signal input PKy;
    signal input r[nCandidates];
    signal input m[nCandidates];
    signal input C1x[nCandidates];
    signal input C1y[nCandidates];
    signal input C2x[nCandidates];
    signal input C2y[nCandidates];

    signal output nullifier;
    signal output hashCipherAll;

    component voter = VoterValidity(depth);
    voter.sk <== sk;
    for (var i = 0; i < depth; i++) {
        voter.pathElements[i] <== pathElements[i];
        voter.pathIndices[i] <== pathIndices[i];
    }
    voter.root <== root;
    voter.hash_pk <== hash_pk;
    voter.election_hash <== election_hash;

    component ballots = MultiCiphertextValidity(nCandidates);
    ballots.PKx <== PKx;
    ballots.PKy <== PKy;
    for (var j = 0; j < nCandidates; j++) {
        ballots.r[j] <== r[j];
        ballots.m[j] <== m[j];
        ballots.C1x[j] <== C1x[j];
        ballots.C1y[j] <== C1y[j];
        ballots.C2x[j] <== C2x[j];
        ballots.C2y[j] <== C2y[j];
    }

    nullifier <== voter.nullifier;
    hashCipherAll <== ballots.hashCipherAll;

    // component finalHash = Poseidon(3);
    // finalHash.inputs[0] <== voter.nullifier;
    // finalHash.inputs[1] <== ballots.hashCipherAll;
    // finalHash.inputs[2] <== root;
    // globalCommit <== finalHash.out;
}

component main = VotingCircuit(10, 2);
