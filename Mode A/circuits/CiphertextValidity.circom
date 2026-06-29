pragma circom 2.1.5;

include "circomlib/circuits/babyjub.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/escalarmulany.circom";
include "circomlib/circuits/bitify.circom";

template PointMux() {
    signal input selector;
    signal input in_x;
    signal input in_y;
    signal output out_x;
    signal output out_y;

    selector * (1 - selector) === 0;

    out_x <== selector * in_x;
    out_y <== selector * (in_y - 1) + 1;
}

template CiphertextValidityOptimized() {
    signal input r;
    signal input m;
    signal input PKx;
    signal input PKy;

    signal input C1x;
    signal input C1y;
    signal input C2x;
    signal input C2y;

    var BASE8[2] = [
        5299619240641551281634865583518297030282874472190772894086521144482721001553,
        16950150798460657717958625567821834550301663161624707787222815936182638968203
    ];

    m * (1 - m) === 0;

    component rBits = Num2Bits(253);
    rBits.in <== r;

    component mulBase_r = EscalarMulFix(253, BASE8);
    for (var i = 0; i < 253; i++) {
        mulBase_r.e[i] <== rBits.out[i];
    }
    C1x === mulBase_r.out[0];
    C1y === mulBase_r.out[1];

    component mulPK = EscalarMulAny(253);
    mulPK.p[0] <== PKx;
    mulPK.p[1] <== PKy;
    for (var i = 0; i < 253; i++) {
        mulPK.e[i] <== rBits.out[i];
    }
    signal rPK_x <== mulPK.out[0];
    signal rPK_y <== mulPK.out[1];

    component mG_mux = PointMux();
    mG_mux.selector <== m;
    mG_mux.in_x <== BASE8[0];
    mG_mux.in_y <== BASE8[1];

    signal mG_x <== mG_mux.out_x;
    signal mG_y <== mG_mux.out_y;

    component addPoints = BabyAdd();
    addPoints.x1 <== mG_x;
    addPoints.y1 <== mG_y;
    addPoints.x2 <== rPK_x;
    addPoints.y2 <== rPK_y;

    C2x === addPoints.xout;
    C2y === addPoints.yout;

    component pose = Poseidon(4);
    pose.inputs[0] <== C1x;
    pose.inputs[1] <== C1y;
    pose.inputs[2] <== C2x;
    pose.inputs[3] <== C2y;

    signal output hashCipher;
    hashCipher <== pose.out;
}

template MultiCiphertextValidity(nCandidates) {
    signal input PKx;
    signal input PKy;
    signal input r[nCandidates];
    signal input m[nCandidates];
    signal input C1x[nCandidates];
    signal input C1y[nCandidates];
    signal input C2x[nCandidates];
    signal input C2y[nCandidates];

    signal output hashCipherAll;

    var FZERO = 0;
    signal acc[nCandidates + 1];
    acc[0] <== FZERO;

    component ct[nCandidates];
    component hashStep[nCandidates];

    for (var i = 0; i < nCandidates; i++) {
        ct[i] = CiphertextValidityOptimized();
        ct[i].PKx <== PKx;
        ct[i].PKy <== PKy;
        ct[i].r <== r[i];
        ct[i].m <== m[i];
        ct[i].C1x <== C1x[i];
        ct[i].C1y <== C1y[i];
        ct[i].C2x <== C2x[i];
        ct[i].C2y <== C2y[i];

        hashStep[i] = Poseidon(2);
        hashStep[i].inputs[0] <== acc[i];
        hashStep[i].inputs[1] <== ct[i].hashCipher;
        acc[i + 1] <== hashStep[i].out;
    }

    hashCipherAll <== acc[nCandidates];
}

// component main = MultiCiphertextValidity(5);
