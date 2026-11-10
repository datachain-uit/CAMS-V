import { create } from "kubo-rpc-client";

const client = create({ url: "http://127.0.0.1:5001" });

async function uploadToIPFS(data) {
  try {
    const result = await client.add(data);
    return result.path;
  } catch (err) {
    console.error("Error IPFS Daemon:", err.message);
    throw err;
  }
}

async function fetchBallotFromIPFS(cid) {
  if (typeof cid !== "string" || !cid.startsWith("ipfs://")) {
    throw new Error("Expected ipfs:// CID");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of client.cat(cid.slice(7))) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("Ballot exceeds 1 MiB");
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export { uploadToIPFS, fetchBallotFromIPFS };
