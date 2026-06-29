// pragma solidity ^0.8.0;

// import "./ParticialDecriptionVerifier.sol";
// import "./VoteProofCombinedVerifier.sol";

// contract E_Voting {
//     address public admin;

//     ParticialDecriptionVerifier public partialVerifier;
//     VoteProofCombinedVerifier public combinedVerifier;

//     enum ElectionStatus {
//         Inactive,
//         Active,
//         Ended
//     }

//     struct ElectionInfo {
//         string electionId;
//         string name;
//         uint256 startDate;
//         uint256 endDate;
//         ElectionStatus status;
//         bytes32 merkleRoot;
//     }

//     struct Candidate {
//         uint256 id;
//         string name;
//         uint256 voteCount;
//     }

//     struct PartialDecryption {
//         uint256[2][] D_points;
//         bool verified;
//     }

//     ElectionInfo public info;
//     Candidate[] public candidates;
//     bytes public epk;

//     bytes32 public hashAllOnChain;
//     address public aggregator;

//     uint256 public thresholdCount;
//     uint256 public constant minRequired = 2;

//     mapping(bytes32 => bool) public isNullifierUsed;
//     mapping(address => bool) public isTrustee;
//     mapping(address => uint256) public trusteeID;
//     mapping(address => bool) public lastVerifyPassed;
//     mapping(address => bool) public hasPublished;

//     event ElectionCreated(string electionId, string name);
//     event ElectionEnded();
//     event MerkleRootUpdated(bytes32 root);
//     event CandidateAdded(uint256 id, string name);
//     event EpkPublished(bytes epk);
//     event VotePublished(bytes32 indexed nullifier, bytes32 indexed hashCipher, string cid);
//     event HashAllOnChainPublished(bytes32 hashAllOnChain);

//     event TrusteeRegistered(address indexed trustee);
//     event PartialDecryptionVerified(address indexed trustee);
//     event PartialDecryptionFailed(address trustee);
//     event PartialDecryptionSubmitted(address indexed trustee, uint256[2][] D_points);
//     event AllTrusteesAgreed();

//     event CipherTotalPublished(
//         uint256 indexed candidateId,
//         uint256[2] C1_total,
//         uint256[2] C2_total
//     );

//     event VoteProofCombinedVerified(
//         address indexed voter,
//         bytes32 indexed nullifier,
//         bytes32 indexed hashCipherAll
//     );

//     modifier onlyAdmin() {
//         require(msg.sender == admin, "Not authorized");
//         _;
//     }

//     modifier onlyActiveElection() {
//         require(info.status == ElectionStatus.Active, "Election not active");
//         _;
//     }

//     modifier onlyAggregator() {
//         require(msg.sender == aggregator, "Not authorized (aggregator only)");
//         _;
//     }

//     modifier onlyTrustee() {
//         require(isTrustee[msg.sender], "Not trustee");
//         _;
//     }

//     constructor(address _partialVerifier, address _combinedVerifier) {
//         require(_partialVerifier != address(0), "invalid partial verifier");
//         require(_combinedVerifier != address(0), "invalid combined verifier");

//         admin = msg.sender;
//         partialVerifier = ParticialDecriptionVerifier(_partialVerifier);
//         combinedVerifier = VoteProofCombinedVerifier(_combinedVerifier);
//     }

//     function setElectionInfo(
//         string memory _id,
//         string memory _name,
//         uint256 _start,
//         uint256 _end
//     ) public onlyAdmin {
//         info = ElectionInfo(_id, _name, _start, _end, ElectionStatus.Active, 0x0);
//         emit ElectionCreated(_id, _name);
//     }

//     function endElection() external onlyAdmin {
//         require(info.status == ElectionStatus.Active, "Not active");
//         info.status = ElectionStatus.Ended;
//         emit ElectionEnded();
//     }

//     function setMerkleRoot(bytes32 _root) external onlyAdmin {
//         info.merkleRoot = _root;
//         emit MerkleRootUpdated(_root);
//     }

//     function addCandidate(string memory _name) public onlyAdmin {
//         candidates.push(Candidate(candidates.length + 1, _name, 0));
//         emit CandidateAdded(candidates.length, _name);
//     }

//     function publishEpk(bytes calldata _epk) external onlyAdmin {
//         epk = _epk;
//         emit EpkPublished(_epk);
//     }

//     function getCandidateCount() public view returns (uint256) {
//         return candidates.length;
//     }

//     function submitVote(
//         bytes32 _nullifier,
//         bytes32 _hashCipher,
//         string calldata _cid
//     ) external onlyActiveElection {
//         require(!isNullifierUsed[_nullifier], "Double vote detected");

//         isNullifierUsed[_nullifier] = true;
//         emit VotePublished(_nullifier, _hashCipher, _cid);
//     }

//     function publishHashAllOnChain(bytes32 _hashAllOnChain) external onlyAdmin {
//         require(hashAllOnChain == 0x0, "Already published");
//         hashAllOnChain = _hashAllOnChain;
//         emit HashAllOnChainPublished(_hashAllOnChain);
//     }

//     function registerTrustees(address[3] calldata _trustees) external onlyAdmin {
//         require(thresholdCount == 0, "Already initialized");

//         for (uint256 i = 0; i < 3; i++) {
//             isTrustee[_trustees[i]] = true;
//             trusteeID[_trustees[i]] = i + 1;
//             emit TrusteeRegistered(_trustees[i]);
//         }
//     }

//     function verifyPartialProof(
//         uint256[2] calldata pA,
//         uint256[2][2] calldata pB,
//         uint256[2] calldata pC,
//         uint256[1] calldata pubSignals
//     ) external onlyTrustee {
//         bool ok = partialVerifier.verifyProof(pA, pB, pC, pubSignals);
//         require(ok, "Invalid partial proof");

//         lastVerifyPassed[msg.sender] = true;
//         emit PartialDecryptionVerified(msg.sender);
//     }

//     function publishPartialDecryption(
//         uint256[2][] calldata D_points
//     ) external onlyTrustee {
//         require(lastVerifyPassed[msg.sender], "Proof not verified");
//         require(!hasPublished[msg.sender], "Already published");
//         require(D_points.length > 0, "Empty D_points");

//         hasPublished[msg.sender] = true;
//         lastVerifyPassed[msg.sender] = false;

//         unchecked {
//             thresholdCount++;
//         }

//         emit PartialDecryptionSubmitted(msg.sender, D_points);

//         if (thresholdCount >= minRequired) {
//             emit AllTrusteesAgreed();
//         }
//     }

//     function setAggregator(address _aggregator) external onlyAdmin {
//         require(_aggregator != address(0), "invalid aggregator");
//         aggregator = _aggregator;
//     }

//     function publishAllCipherTotals(
//         uint256[2][] calldata C1_list,
//         uint256[2][] calldata C2_list
//     ) external onlyAggregator {
//         require(C1_list.length == C2_list.length, "Length mismatch");

//         for (uint256 i = 0; i < C1_list.length; i++) {
//             emit CipherTotalPublished(i + 1, C1_list[i], C2_list[i]);
//         }
//     }

//     function verifyVoteProofCombined(
//         uint256[2] calldata pA,
//         uint256[2][2] calldata pB,
//         uint256[2] calldata pC,
//         uint256[2] calldata pubSignals
//     ) public view returns (bool) {
//         return combinedVerifier.verifyProof(pA, pB, pC, pubSignals);
//     }

//     function submitVoteWithProof(
//         uint256[2] calldata pA,
//         uint256[2][2] calldata pB,
//         uint256[2] calldata pC,
//         uint256[2] calldata pubSignals,
//         bytes32 _nullifier,
//         bytes32 _hashCipherAll,
//         string calldata _cid
//     ) external onlyActiveElection onlyAdmin {
//         require(!isNullifierUsed[_nullifier], "Double vote detected");
//         require(bytes32(pubSignals[0]) == _nullifier, "nullifier mismatch");
//         require(bytes32(pubSignals[1]) == _hashCipherAll, "hashCipherAll mismatch");

//         bool ok = combinedVerifier.verifyProof(pA, pB, pC, pubSignals);
//         require(ok, "Invalid combined proof");

//         isNullifierUsed[_nullifier] = true;

//         // emit VoteProofCombinedVerified(msg.sender, _nullifier, _hashCipherAll);
//         emit VotePublished(_nullifier, _hashCipherAll, _cid);
//     }
// }


// pragma solidity ^0.8.0;

// import "./ParticialDecriptionVerifier.sol";
// import "./VoteProofCombinedVerifier.sol";

// contract E_Voting {
//     address public admin;

//     ParticialDecriptionVerifier public partialVerifier;
//     VoteProofCombinedVerifier public combinedVerifier;

//     enum ElectionStatus {
//         Inactive,
//         Active,
//         Ended
//     }

//     struct ElectionInfo {
//         string electionId;
//         string name;
//         uint256 startDate;
//         uint256 endDate;
//         ElectionStatus status;
//         bytes32 merkleRoot;
//     }

//     struct Candidate {
//         uint256 id;
//         string name;
//         uint256 voteCount;
//     }

//     ElectionInfo public info;
//     Candidate[] public candidates;
//     bytes public epk;

//     bytes32 public hashAllOnChain;
//     address public aggregator;

//     uint256 public thresholdCount;
//     uint256 public constant minRequired = 2;

//     mapping(bytes32 => bool) public isNullifierUsed;
//     mapping(address => bool) public isTrustee;
//     mapping(address => uint256) public trusteeID;
//     mapping(address => bool) public lastVerifyPassed;
//     mapping(address => bool) public hasPublished;

//     event ElectionCreated(string electionId, string name);
//     event ElectionEnded();
//     event MerkleRootUpdated(bytes32 root);
//     event CandidateAdded(uint256 id, string name);
//     event EpkPublished(bytes epk);
//     event VotePublished(bytes32 indexed nullifier, bytes32 indexed hashCipher, string cid);
//     event HashAllOnChainPublished(bytes32 hashAllOnChain);

//     event TrusteeRegistered(address indexed trustee);
//     event PartialDecryptionVerified(address indexed trustee);
//     event PartialDecryptionFailed(address trustee);
//     event PartialDecryptionSubmitted(address indexed trustee, uint256[2][] D_points);
//     event AllTrusteesAgreed();

//     event CipherTotalPublished(
//         uint256 indexed candidateId,
//         uint256[2] C1_total,
//         uint256[2] C2_total
//     );

//     event VoteProofCombinedVerified(
//         address indexed voter,
//         bytes32 indexed nullifier,
//         bytes32 indexed hashCipherAll
//     );

//     event VoteApprovalVerified(
//         bytes32 indexed nullifier,
//         bytes32 indexed hashCipherAll,
//         address signer1,
//         address signer2
//     );

//     modifier onlyAdmin() {
//         require(msg.sender == admin, "Not authorized");
//         _;
//     }

//     modifier onlyActiveElection() {
//         require(info.status == ElectionStatus.Active, "Election not active");
//         _;
//     }

//     modifier onlyAggregator() {
//         require(msg.sender == aggregator, "Not authorized (aggregator only)");
//         _;
//     }

//     modifier onlyTrustee() {
//         require(isTrustee[msg.sender], "Not trustee");
//         _;
//     }

//     constructor(address _partialVerifier, address _combinedVerifier) {
//         require(_partialVerifier != address(0), "invalid partial verifier");
//         require(_combinedVerifier != address(0), "invalid combined verifier");

//         admin = msg.sender;
//         partialVerifier = ParticialDecriptionVerifier(_partialVerifier);
//         combinedVerifier = VoteProofCombinedVerifier(_combinedVerifier);
//     }

//     function toEthSignedMessageHash(bytes32 hash) internal pure returns (bytes32) {
//         return keccak256(
//             abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)
//         );
//     }

//     function recoverSigner(
//         bytes32 ethSignedMessageHash,
//         bytes memory signature
//     ) internal pure returns (address) {
//         require(signature.length == 65, "invalid signature length");

//         bytes32 r;
//         bytes32 s;
//         uint8 v;

//         assembly {
//             r := mload(add(signature, 32))
//             s := mload(add(signature, 64))
//             v := byte(0, mload(add(signature, 96)))
//         }

//         if (v < 27) {
//             v += 27;
//         }

//         require(v == 27 || v == 28, "invalid v");

//         require(
//             uint256(s) <=
//                 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0,
//             "invalid signature s"
//         );

//         address signer = ecrecover(ethSignedMessageHash, v, r, s);
//         require(signer != address(0), "invalid signature");

//         return signer;
//     }

//     function setElectionInfo(
//         string memory _id,
//         string memory _name,
//         uint256 _start,
//         uint256 _end
//     ) public onlyAdmin {
//         info = ElectionInfo(_id, _name, _start, _end, ElectionStatus.Active, 0x0);
//         emit ElectionCreated(_id, _name);
//     }

//     function endElection() external onlyAdmin {
//         require(info.status == ElectionStatus.Active, "Not active");
//         info.status = ElectionStatus.Ended;
//         emit ElectionEnded();
//     }

//     function setMerkleRoot(bytes32 _root) external onlyAdmin {
//         info.merkleRoot = _root;
//         emit MerkleRootUpdated(_root);
//     }

//     function addCandidate(string memory _name) public onlyAdmin {
//         candidates.push(Candidate(candidates.length + 1, _name, 0));
//         emit CandidateAdded(candidates.length, _name);
//     }

//     function publishEpk(bytes calldata _epk) external onlyAdmin {
//         epk = _epk;
//         emit EpkPublished(_epk);
//     }

//     function getCandidateCount() public view returns (uint256) {
//         return candidates.length;
//     }

//     function submitVote(
//         bytes32 _nullifier,
//         bytes32 _hashCipher,
//         string calldata _cid
//     ) external onlyActiveElection {
//         require(!isNullifierUsed[_nullifier], "Double vote detected");

//         isNullifierUsed[_nullifier] = true;
//         emit VotePublished(_nullifier, _hashCipher, _cid);
//     }

//     function publishHashAllOnChain(bytes32 _hashAllOnChain) external onlyAdmin {
//         require(hashAllOnChain == 0x0, "Already published");
//         hashAllOnChain = _hashAllOnChain;
//         emit HashAllOnChainPublished(_hashAllOnChain);
//     }

//     function registerTrustees(address[3] calldata _trustees) external onlyAdmin {
//         require(thresholdCount == 0, "Already initialized");

//         for (uint256 i = 0; i < 3; i++) {
//             isTrustee[_trustees[i]] = true;
//             trusteeID[_trustees[i]] = i + 1;
//             emit TrusteeRegistered(_trustees[i]);
//         }
//     }

//     function verifyPartialProof(
//         uint256[2] calldata pA,
//         uint256[2][2] calldata pB,
//         uint256[2] calldata pC,
//         uint256[1] calldata pubSignals
//     ) external onlyTrustee {
//         bool ok = partialVerifier.verifyProof(pA, pB, pC, pubSignals);
//         require(ok, "Invalid partial proof");

//         lastVerifyPassed[msg.sender] = true;
//         emit PartialDecryptionVerified(msg.sender);
//     }

//     function publishPartialDecryption(
//         uint256[2][] calldata D_points
//     ) external onlyTrustee {
//         require(lastVerifyPassed[msg.sender], "Proof not verified");
//         require(!hasPublished[msg.sender], "Already published");
//         require(D_points.length > 0, "Empty D_points");

//         hasPublished[msg.sender] = true;
//         lastVerifyPassed[msg.sender] = false;

//         unchecked {
//             thresholdCount++;
//         }

//         emit PartialDecryptionSubmitted(msg.sender, D_points);

//         if (thresholdCount >= minRequired) {
//             emit AllTrusteesAgreed();
//         }
//     }

//     function setAggregator(address _aggregator) external onlyAdmin {
//         require(_aggregator != address(0), "invalid aggregator");
//         aggregator = _aggregator;
//     }

//     function publishAllCipherTotals(
//         uint256[2][] calldata C1_list,
//         uint256[2][] calldata C2_list
//     ) external onlyAggregator {
//         require(C1_list.length == C2_list.length, "Length mismatch");

//         for (uint256 i = 0; i < C1_list.length; i++) {
//             emit CipherTotalPublished(i + 1, C1_list[i], C2_list[i]);
//         }
//     }

//     function verifyVoteProofCombined(
//         uint256[2] calldata pA,
//         uint256[2][2] calldata pB,
//         uint256[2] calldata pC,
//         uint256[2] calldata pubSignals
//     ) public view returns (bool) {
//         return combinedVerifier.verifyProof(pA, pB, pC, pubSignals);
//     }

//     // Flow cũ: verify proof on-chain
//     function submitVoteWithProof(
//         uint256[2] calldata pA,
//         uint256[2][2] calldata pB,
//         uint256[2] calldata pC,
//         uint256[2] calldata pubSignals,
//         bytes32 _nullifier,
//         bytes32 _hashCipherAll,
//         string calldata _cid
//     ) external onlyActiveElection onlyAdmin {
//         require(!isNullifierUsed[_nullifier], "Double vote detected");
//         require(bytes32(pubSignals[0]) == _nullifier, "nullifier mismatch");
//         require(bytes32(pubSignals[1]) == _hashCipherAll, "hashCipherAll mismatch");

//         bool ok = combinedVerifier.verifyProof(pA, pB, pC, pubSignals);
//         require(ok, "Invalid combined proof");

//         isNullifierUsed[_nullifier] = true;
//         emit VotePublished(_nullifier, _hashCipherAll, _cid);
//     }

//     // Flow mới: CA gom 2 chữ ký trustee rồi submit
//     function getVoteApprovalDigest(
//         bytes32 _nullifier,
//         bytes32 _hashCipherAll,
//         string calldata _cid
//     ) public view returns (bytes32) {
//         return keccak256(
//             abi.encode(
//                 info.electionId,
//                 info.merkleRoot,
//                 _nullifier,
//                 _hashCipherAll,
//                 keccak256(bytes(_cid)),
//                 block.chainid,
//                 address(this)
//             )
//         );
//     }

//     function submitVoteWithTrusteeSignatures(
//         bytes32 _nullifier,
//         bytes32 _hashCipherAll,
//         string calldata _cid,
//         bytes calldata sig1,
//         bytes calldata sig2
//     ) external onlyActiveElection onlyAdmin {
//         require(!isNullifierUsed[_nullifier], "Double vote detected");

//         bytes32 rawDigest = getVoteApprovalDigest(
//             _nullifier,
//             _hashCipherAll,
//             _cid
//         );
//         bytes32 ethSignedDigest = toEthSignedMessageHash(rawDigest);

//         address signer1 = recoverSigner(ethSignedDigest, sig1);
//         address signer2 = recoverSigner(ethSignedDigest, sig2);

//         require(isTrustee[signer1], "Signer1 not trustee");
//         require(isTrustee[signer2], "Signer2 not trustee");
//         require(signer1 != signer2, "Duplicate trustee signatures");

//         isNullifierUsed[_nullifier] = true;

//         emit VoteApprovalVerified(_nullifier, _hashCipherAll, signer1, signer2);
//         emit VotePublished(_nullifier, _hashCipherAll, _cid);
//     }
// }

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./PartialDecryptionVerifier.sol";
import "./VoteProofCombinedVerifier.sol";

contract E_Voting {
    address public admin;

    PartialDecryptionVerifier public partialVerifier;
    VoteProofCombinedVerifier public combinedVerifier;

    enum ElectionStatus {
        Inactive,
        Active,
        Ended
    }

    struct ElectionInfo {
        string electionId;
        string name;
        uint256 startDate;
        uint256 endDate;
        ElectionStatus status;
        bytes32 merkleRoot;
    }

    struct Candidate {
        uint256 id;
        string name;
        uint256 voteCount;
    }

    ElectionInfo public info;
    Candidate[] public candidates;
    bytes public epk;

    bytes32 public hashAllOnChain;
    address public aggregator;

    uint256 public thresholdCount;
    uint256 public thresholdRequired;
    uint256 public trusteeCount;

    mapping(bytes32 => bool) public isNullifierUsed;
    mapping(address => bool) public isTrustee;
    mapping(address => uint256) public trusteeID;
    mapping(address => bool) public lastVerifyPassed;
    mapping(address => bool) public hasPublished;

    event ElectionCreated(string electionId, string name);
    event ElectionEnded();
    event MerkleRootUpdated(bytes32 root);
    event CandidateAdded(uint256 id, string name);
    event EpkPublished(bytes epk);
    event VotePublished(bytes32 indexed nullifier, bytes32 indexed hashCipher, string cid);
    event HashAllOnChainPublished(bytes32 hashAllOnChain);

    event TrusteeRegistered(address indexed trustee);
    event PartialDecryptionVerified(address indexed trustee);
    event PartialDecryptionFailed(address trustee);
    event PartialDecryptionSubmitted(address indexed trustee, uint256[2][] D_points);
    event AllTrusteesAgreed();

    event CipherTotalPublished(
        uint256 indexed candidateId,
        uint256[2] C1_total,
        uint256[2] C2_total
    );

    event VoteProofCombinedVerified(
        address indexed voter,
        bytes32 indexed nullifier,
        bytes32 indexed hashCipherAll
    );

    event VoteApprovalVerified(
        bytes32 indexed nullifier,
        bytes32 indexed hashCipherAll,
        address[] signers
    );

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not authorized");
        _;
    }

    modifier onlyActiveElection() {
        require(info.status == ElectionStatus.Active, "Election not active");
        _;
    }

    modifier onlyAggregator() {
        require(msg.sender == aggregator, "Not authorized (aggregator only)");
        _;
    }

    modifier onlyTrustee() {
        require(isTrustee[msg.sender], "Not trustee");
        _;
    }

    constructor(address _partialVerifier, address _combinedVerifier) {
        require(_partialVerifier != address(0), "invalid partial verifier");
        require(_combinedVerifier != address(0), "invalid combined verifier");

        admin = msg.sender;
        partialVerifier = PartialDecryptionVerifier(_partialVerifier);
        combinedVerifier = VoteProofCombinedVerifier(_combinedVerifier);
    }

    function toEthSignedMessageHash(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)
        );
    }

    function recoverSigner(
        bytes32 ethSignedMessageHash,
        bytes memory signature
    ) internal pure returns (address) {
        require(signature.length == 65, "invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }

        if (v < 27) {
            v += 27;
        }

        require(v == 27 || v == 28, "invalid v");

        require(
            uint256(s) <=
                0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0,
            "invalid signature s"
        );

        address signer = ecrecover(ethSignedMessageHash, v, r, s);
        require(signer != address(0), "invalid signature");

        return signer;
    }

    function setElectionInfo(
        string memory _id,
        string memory _name,
        uint256 _start,
        uint256 _end
    ) public onlyAdmin {
        info = ElectionInfo(_id, _name, _start, _end, ElectionStatus.Active, 0x0);
        emit ElectionCreated(_id, _name);
    }

    function endElection() external onlyAdmin {
        require(info.status == ElectionStatus.Active, "Not active");
        info.status = ElectionStatus.Ended;
        emit ElectionEnded();
    }

    function setMerkleRoot(bytes32 _root) external onlyAdmin {
        info.merkleRoot = _root;
        emit MerkleRootUpdated(_root);
    }

    function addCandidate(string memory _name) public onlyAdmin {
        candidates.push(Candidate(candidates.length + 1, _name, 0));
        emit CandidateAdded(candidates.length, _name);
    }

    function publishEpk(bytes calldata _epk) external onlyAdmin {
        epk = _epk;
        emit EpkPublished(_epk);
    }

    function getCandidateCount() public view returns (uint256) {
        return candidates.length;
    }

    function submitVote(
        bytes32 _nullifier,
        bytes32 _hashCipher,
        string calldata _cid
    ) external onlyActiveElection {
        require(!isNullifierUsed[_nullifier], "Double vote detected");

        isNullifierUsed[_nullifier] = true;
        emit VotePublished(_nullifier, _hashCipher, _cid);
    }

    function publishHashAllOnChain(bytes32 _hashAllOnChain) external onlyAdmin {
        require(hashAllOnChain == 0x0, "Already published");
        hashAllOnChain = _hashAllOnChain;
        emit HashAllOnChainPublished(_hashAllOnChain);
    }

    function registerTrustees(
        address[] calldata _trustees,
        uint256 _thresholdRequired
    ) external onlyAdmin {
        require(trusteeCount == 0, "Already initialized");
        require(_trustees.length > 0, "Empty trustee list");
        require(
            _thresholdRequired > 0 && _thresholdRequired <= _trustees.length,
            "Invalid threshold"
        );

        trusteeCount = _trustees.length;
        thresholdRequired = _thresholdRequired;

        for (uint256 i = 0; i < _trustees.length; i++) {
            address trustee = _trustees[i];
            require(trustee != address(0), "Invalid trustee");
            require(!isTrustee[trustee], "Duplicate trustee");

            isTrustee[trustee] = true;
            trusteeID[trustee] = i + 1;
            emit TrusteeRegistered(trustee);
        }
    }

    function verifyPartialProof(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[1] calldata pubSignals
    ) external onlyTrustee {
        bool ok = partialVerifier.verifyProof(pA, pB, pC, pubSignals);
        require(ok, "Invalid partial proof");

        lastVerifyPassed[msg.sender] = true;
        emit PartialDecryptionVerified(msg.sender);
    }

    function publishPartialDecryption(
        uint256[2][] calldata D_points
    ) external onlyTrustee {
        require(lastVerifyPassed[msg.sender], "Proof not verified");
        require(!hasPublished[msg.sender], "Already published");
        require(D_points.length > 0, "Empty D_points");

        hasPublished[msg.sender] = true;
        lastVerifyPassed[msg.sender] = false;

        unchecked {
            thresholdCount++;
        }

        emit PartialDecryptionSubmitted(msg.sender, D_points);

        if (thresholdCount >= thresholdRequired) {
            emit AllTrusteesAgreed();
        }
    }

    function setAggregator(address _aggregator) external onlyAdmin {
        require(_aggregator != address(0), "invalid aggregator");
        aggregator = _aggregator;
    }

    function publishAllCipherTotals(
        uint256[2][] calldata C1_list,
        uint256[2][] calldata C2_list
    ) external onlyAggregator {
        require(C1_list.length == C2_list.length, "Length mismatch");

        for (uint256 i = 0; i < C1_list.length; i++) {
            emit CipherTotalPublished(i + 1, C1_list[i], C2_list[i]);
        }
    }

    function verifyVoteProofCombined(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[2] calldata pubSignals
    ) public view returns (bool) {
        return combinedVerifier.verifyProof(pA, pB, pC, pubSignals);
    }

    function submitVoteWithProof(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[2] calldata pubSignals,
        bytes32 _nullifier,
        bytes32 _hashCipherAll,
        string calldata _cid
    ) external onlyActiveElection onlyAdmin {
        require(!isNullifierUsed[_nullifier], "Double vote detected");
        require(bytes32(pubSignals[0]) == _nullifier, "nullifier mismatch");
        require(bytes32(pubSignals[1]) == _hashCipherAll, "hashCipherAll mismatch");

        bool ok = combinedVerifier.verifyProof(pA, pB, pC, pubSignals);
        require(ok, "Invalid combined proof");

        isNullifierUsed[_nullifier] = true;
        emit VotePublished(_nullifier, _hashCipherAll, _cid);
    }

    function getVoteApprovalDigest(
        bytes32 _nullifier,
        bytes32 _hashCipherAll,
        string calldata _cid
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                info.electionId,
                info.merkleRoot,
                _nullifier,
                _hashCipherAll,
                keccak256(bytes(_cid)),
                block.chainid,
                address(this)
            )
        );
    }

    function submitVoteWithTrusteeSignatures(
        bytes32 _nullifier,
        bytes32 _hashCipherAll,
        string calldata _cid,
        bytes[] calldata signatures
    ) external onlyActiveElection onlyAdmin {
        require(!isNullifierUsed[_nullifier], "Double vote detected");
        require(signatures.length >= thresholdRequired, "Not enough signatures");

        bytes32 rawDigest = getVoteApprovalDigest(
            _nullifier,
            _hashCipherAll,
            _cid
        );
        bytes32 ethSignedDigest = toEthSignedMessageHash(rawDigest);

        address[] memory signers = new address[](signatures.length);

        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = recoverSigner(ethSignedDigest, signatures[i]);
            require(isTrustee[signer], "Signer not trustee");

            for (uint256 j = 0; j < i; j++) {
                require(signers[j] != signer, "Duplicate trustee signatures");
            }

            signers[i] = signer;
        }

        isNullifierUsed[_nullifier] = true;

        emit VoteApprovalVerified(_nullifier, _hashCipherAll, signers);
        emit VotePublished(_nullifier, _hashCipherAll, _cid);
    }

    bool public resultRevealed;

event ResultRevealed(uint indexed candidateId, uint voteCount);
event AllResultsRevealed(uint[] counts);

function revealResults(uint[] calldata counts) external onlyAdmin {
    require(thresholdCount >= thresholdRequired, "Not enough partial decryptions");
    require(counts.length == candidates.length, "Length mismatch");

    for (uint256 i = 0; i < counts.length; i++) {
        candidates[i].voteCount = counts[i];
        emit ResultRevealed(i + 1, counts[i]);
    }

    resultRevealed = true;
    emit AllResultsRevealed(counts);
}
}