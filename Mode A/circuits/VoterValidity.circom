pragma circom 2.1.5;

include "circomlib/circuits/babyjub.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/mux1.circom";

template VoterValidity(depth) {
    signal input sk;             
    signal input pathElements[depth];
    signal input pathIndices[depth];

    signal input root;         
    signal input hash_pk;      
    signal input election_hash;

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