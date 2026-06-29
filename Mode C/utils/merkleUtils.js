import { buildPoseidon } from "circomlibjs";

function poseidonHash(poseidon, inputs) {
  return poseidon.F.toObject(poseidon(inputs));
}

function buildMerkleTree(poseidon, leaves) {
  const tree = [leaves];
  while (tree[tree.length - 1].length > 1) {
    const prev = tree[tree.length - 1];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      const left = prev[i];
      const right = i + 1 < prev.length ? prev[i + 1] : left;
      next.push(poseidonHash(poseidon, [left, right]));
    }
    tree.push(next);
  }
  return tree;
}

function getMerkleRoot(tree) {
  return tree[tree.length - 1][0];
}

function getMerkleProof(tree, index) {
  const proof = [];
  for (let level = 0; level < tree.length - 1; level++) {
    const currentLevel = tree[level];
    const isRight = index % 2;
    const siblingIndex = isRight ? index - 1 : index + 1;
    const sibling =
      siblingIndex < currentLevel.length
        ? currentLevel[siblingIndex]
        : currentLevel[index];
    proof.push({ sibling, isRight });
    index = Math.floor(index / 2);
  }

  const pathElements = proof.map((p) => p.sibling);
  const pathIndices = proof.map((p) => (p.isRight ? 1 : 0));
  return { pathElements, pathIndices, proof };
}

async function generatePoseidonMerkleInfo(leaves, leafIndex) {
  const poseidon = await buildPoseidon();

  const tree = buildMerkleTree(poseidon, leaves);
  const root = getMerkleRoot(tree);

  const { pathElements, pathIndices, proof } = getMerkleProof(tree, leafIndex);

  return {
    root,
    pathElements,
    pathIndices,
    proof,
    poseidon,
  };
}

export { buildMerkleTree, getMerkleRoot, getMerkleProof };
