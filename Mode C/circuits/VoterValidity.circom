pragma circom 2.1.5;

include "circomlib/circuits/babyjub.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/mux1.circom";
include "circomlib/circuits/comparators.circom";

template VoterValidity(depth) {
    signal input sk;             
    signal input pathElements[depth];
    signal input pathIndices[depth];

    signal input root;         
    signal input hash_pk;      
    signal input election_hash;

    // A unique scalar representation is required because the nullifier hashes
    // sk, while the voter public key only determines sk modulo the subgroup order.
    component skBits = Num2Bits(251);
    skBits.in <== sk;
    component skRange = LessThan(251);
    skRange.in[0] <== sk;
    skRange.in[1] <== 2736030358979909402780800718157159386076813972158567259200215660948447373041;
    skRange.out === 1;

    component gen = BabyPbk();
    gen.in <== sk;

    component pkHash = Poseidon(2);
    pkHash.inputs[0] <== gen.Ax;
    pkHash.inputs[1] <== gen.Ay;

    pkHash.out === hash_pk;

    signal cur[depth + 1];
    cur[0] <== hash_pk;

    component h[depth];
    component mux[depth][2];
    
    signal left[depth];
    signal right[depth];

    for (var i = 0; i < depth; i++) {
        pathIndices[i] * (1 - pathIndices[i]) === 0;
        mux[i][0] = Mux1();
        mux[i][0].c[0] <== cur[i];
        mux[i][0].c[1] <== pathElements[i];
        mux[i][0].s <== pathIndices[i];
        
        left[i] <== mux[i][0].out;

        mux[i][1] = Mux1();
        mux[i][1].c[0] <== pathElements[i];
        mux[i][1].c[1] <== cur[i];
        mux[i][1].s <== pathIndices[i];
        
        right[i] <== mux[i][1].out;

        h[i] = Poseidon(2);
        h[i].inputs[0] <== left[i]; 
        h[i].inputs[1] <== right[i];
        cur[i + 1] <== h[i].out;
    }

    root === cur[depth];

    component nullifierHash = Poseidon(2);
    nullifierHash.inputs[0] <== sk;
    nullifierHash.inputs[1] <== election_hash;

    signal output nullifier;
    nullifier <== nullifierHash.out;
}

// component main = VoterValidity(3);
