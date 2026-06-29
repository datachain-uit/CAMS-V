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

export { uploadToIPFS };
