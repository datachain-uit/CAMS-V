pragma circom 2.1.5;

include "circomlib/circuits/babyjub.circom";
include "circomlib/circuits/escalarmulany.circom";
include "circomlib/circuits/bitify.circom";

template TallyValidity(nTrustees) {
    signal input C2_total_x;
    signal input C2_total_y;

    signal input D_x[nTrustees];
    signal input D_y[nTrustees];
    signal input lambda[nTrustees];

    signal input Mx;
    signal input My;

    component bits[nTrustees];
    component mulD[nTrustees];
    component addD[nTrustees];
    component finalSub = BabyAdd();

    signal accD_x[nTrustees + 1];
    signal accD_y[nTrustees + 1];

    accD_x[0] <== 0;
    accD_y[0] <== 1;

    for (var i = 0; i < nTrustees; i++) {
        bits[i] = Num2Bits(253);
        bits[i].in <== lambda[i];

        mulD[i] = EscalarMulAny(253);
        for (var j = 0; j < 253; j++) {
            mulD[i].e[j] <== bits[i].out[j];
        }
        mulD[i].p[0] <== D_x[i];
        mulD[i].p[1] <== D_y[i];

        addD[i] = BabyAdd();
        addD[i].x1 <== accD_x[i];
        addD[i].y1 <== accD_y[i];
        addD[i].x2 <== mulD[i].out[0];
        addD[i].y2 <== mulD[i].out[1];

        accD_x[i + 1] <== addD[i].xout;
        accD_y[i + 1] <== addD[i].yout;
    }

    signal Dsum_x <== accD_x[nTrustees];
    signal Dsum_y <== accD_y[nTrustees];

    signal negD_x <== -Dsum_x;

    finalSub.x1 <== C2_total_x;
    finalSub.y1 <== C2_total_y;
    finalSub.x2 <== negD_x;
    finalSub.y2 <== Dsum_y;

    finalSub.xout === Mx;
    finalSub.yout === My;

}

// component main = TallyValidity(2);

template BatchTallyValidity(nTrustees, nCandidates) {
    signal input C2_total_x[nCandidates];
    signal input C2_total_y[nCandidates];
    signal input Mx[nCandidates];
    signal input My[nCandidates];

    signal input D_x[nCandidates][nTrustees];
    signal input D_y[nCandidates][nTrustees];

    signal input lambda[nTrustees];
    signal output valid;

    component tallyChecks[nCandidates];

    for (var j = 0; j < nCandidates; j++) {
        tallyChecks[j] = TallyValidity(nTrustees);

        tallyChecks[j].C2_total_x <== C2_total_x[j];
        tallyChecks[j].C2_total_y <== C2_total_y[j];
        tallyChecks[j].Mx <== Mx[j];
        tallyChecks[j].My <== My[j];

        for (var i = 0; i < nTrustees; i++) {
            tallyChecks[j].D_x[i] <== D_x[j][i];
            tallyChecks[j].D_y[i] <== D_y[j][i];
            tallyChecks[j].lambda[i] <== lambda[i];
        }
    }

    valid <== 1;
}

component main = BatchTallyValidity(2, 2);