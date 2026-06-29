pragma circom 2.1.5;

include "circomlib/circuits/babyjub.circom";
include "circomlib/circuits/escalarmulfix.circom";
include "circomlib/circuits/escalarmulany.circom";
include "circomlib/circuits/bitify.circom";

template PartialDecryptionProof() {
    signal input C1x;
    signal input C1y;

    signal input D_ix;
    signal input D_iy;

    signal input PKx;
    signal input PKy;

    signal input s_i;

    signal output valid;

    // PK_i = s_i * G
    component pbk = BabyPbk();
    pbk.in <== s_i;

    PKx === pbk.Ax;
    PKy === pbk.Ay;

    // D_i = s_i * C1
    component bits = Num2Bits(253);
    bits.in <== s_i;

    component mul2 = EscalarMulAny(253);
    for (var i = 0; i < 253; i++) {
        mul2.e[i] <== bits.out[i];
    }

    mul2.p[0] <== C1x;
    mul2.p[1] <== C1y;

    D_ix === mul2.out[0];
    D_iy === mul2.out[1];

    valid <== 1;
}

component main = PartialDecryptionProof();
