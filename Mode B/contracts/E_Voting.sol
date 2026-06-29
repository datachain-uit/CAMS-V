// pragma solidity ^0.8.0;

// import "./ParticialDecriptionVerifier.sol";

// contract E_Voting is ParticialDecriptionVerifier{
//     address public admin;

//     enum ElectionStatus { Inactive, Active, Ended }

//     struct ElectionInfo {
//         string electionId;
//         string name;
//         uint startDate;
//         uint endDate;
//         ElectionStatus status;
//         bytes32 merkleRoot;
//     }


//     struct Candidate {
//         uint id;
//         string name;
//         uint voteCount;
//     }


//     ElectionInfo public info;
//     Candidate[] public candidates;
//     bytes public epk;

//     event ElectionCreated(string electionId, string name);
//     event MerkleRootUpdated(bytes32 root);
//     event CandidateAdded(uint id, string name);
//     event EpkPublished(bytes epk);
//     event VotePublished(bytes32 indexed nullifier, bytes32 indexed hashCipher, string cid);
//     constructor() {
//         admin = msg.sender;
//     }
    

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

//     function setElectionInfo(
//         string memory _id,
//         string memory _name,
//         uint _start,
//         uint _end
//     ) public onlyAdmin {
//         info = ElectionInfo(_id, _name, _start, _end, ElectionStatus.Active, 0x0);
//         emit ElectionCreated(_id, _name);
//     }

//     event ElectionEnded();

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

//     function getCandidateCount() public view returns (uint) {
//         return candidates.length;
//     }

//     mapping(bytes32 => bool) public isNullifierUsed;



//     function submitVote(bytes32 _nullifier, bytes32 _hashCipher, string calldata _cid) external onlyActiveElection{

//         require(!isNullifierUsed[_nullifier], "Double vote detected");

//         isNullifierUsed[_nullifier] = true;

//         emit VotePublished(_nullifier, _hashCipher, _cid);
//     }


//     bytes32 public hashAllOnChain;
//     event HashAllOnChainPublished(bytes32 hashAllOnChain);

//     function publishHashAllOnChain(bytes32 _hashAllOnChain) external onlyAdmin {
//         require(hashAllOnChain == 0x0, "Already published");
//         hashAllOnChain = _hashAllOnChain;
//         emit HashAllOnChainPublished(_hashAllOnChain);
//     }

//     // Aggregator nộp kết quả tổng hợp
//     //bytes public finalCipher;
//     //bytes32 public tallyProofHash;
//     //event TallySubmitted(bytes C_total, bytes32 proofHash);

//     //function submitTally(bytes calldata _C_total, bytes32 _proofHash) external onlyAdmin {
//     //    require(hashOnChain != 0x0, "hashOnChain not set");
//     //    finalCipher = _C_total;
//     //    tallyProofHash = _proofHash;
//     //    emit TallySubmitted(_C_total, _proofHash);
//     //}

// struct PartialDecryption {
//     uint256[2][] D_points; 
//     bool verified;
// }
// //mapping(address => PartialDecryption) public partialDecryptions;

// mapping(address => bool) public isTrustee;
// mapping(address => uint256) public trusteeID;

// uint256 public thresholdCount;
// uint256 public constant minRequired = 2; // 2/3 in 3 trustee

// // Event
// event TrusteeRegistered(address indexed trustee);
// event PartialDecryptionVerified(address indexed trustee);
// event PartialDecryptionSubmitted(address indexed trustee, uint256[2][] D_points);
// event AllTrusteesAgreed();

// function registerTrustees(address[3] calldata _trustees) external onlyAdmin {
//     require(thresholdCount == 0, "Already initialized");
//     for (uint i = 0; i < 3; i++) {
//         isTrustee[_trustees[i]] = true;
//         trusteeID[_trustees[i]] = i + 1; 
//         emit TrusteeRegistered(_trustees[i]);
//     }
// }

// mapping(address => bool) public lastVerifyPassed;
// event PartialDecryptionFailed(address trustee);

// // function verifyPartialProof(
// //     uint[2] calldata pA,
// //     uint[2][2] calldata pB,
// //     uint[2] calldata pC,
// //     uint[1] calldata pubSignals
// // ) external onlyTrustee returns (bool) {

// //     bool ok = _safeVerifyPartialProof(pA, pB, pC, pubSignals); // dùng wrapper

// //     if (ok) {
// //         lastVerifyPassed[msg.sender] = true;
// //         emit PartialDecryptionVerified(msg.sender);
// //     } else {
// //         emit PartialDecryptionFailed(msg.sender);
// //     }

// //     return ok;
// // }

// function verifyPartialProof(
//     uint[2] calldata pA,
//     uint[2][2] calldata pB,
//     uint[2] calldata pC,
//     uint[1] calldata pubSignals
// ) external onlyTrustee {
//     bool ok = _safeVerifyPartialProof(pA, pB, pC, pubSignals);
//     require(ok, "Invalid ZK Proof");
//     lastVerifyPassed[msg.sender] = true;
//     emit PartialDecryptionVerified(msg.sender);
// }


// function _safeVerifyPartialProof(
//     uint[2] memory pA,
//     uint[2][2] memory pB,
//     uint[2] memory pC,
//     uint[1] memory pubSignals
// ) internal view returns (bool) {
//     (bool success, bytes memory result) = address(this).staticcall(
//         abi.encodeWithSignature(
//             "verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[1])",
//             pA, pB, pC, pubSignals
//         )
//     );
//     if (!success || result.length < 32) return false;
//     return abi.decode(result, (bool));
// }

// mapping(address => bool) public hasPublished;

// function publishPartialDecryption(
//     uint256[2][] calldata D_points
// ) external onlyTrustee {
//     require(lastVerifyPassed[msg.sender], "Proof not verified");
//     //require(!partialDecryptions[msg.sender].verified, "Already submitted");
//     require(!hasPublished[msg.sender], "Already published");
//     require(D_points.length > 0, "Empty D_points");

//     hasPublished[msg.sender] = true;
//     lastVerifyPassed[msg.sender] = false;

//     unchecked {
//         thresholdCount++;
//     }

//     emit PartialDecryptionSubmitted(msg.sender, D_points);

//     if (thresholdCount >= minRequired) {
//         emit AllTrusteesAgreed();
//     }
// }   

// address public aggregator;

// event CipherTotalPublished(
//     uint indexed candidateId,
//     uint[2] C1_total,
//     uint[2] C2_total
// );

// function setAggregator(address _aggregator) external onlyAdmin {
//     require(_aggregator != address(0), "invalid aggregator");
//     aggregator = _aggregator;
// }


// function publishAllCipherTotals(
//     uint[2][] calldata C1_list,
//     uint[2][] calldata C2_list
// ) external onlyAggregator {
//     require(C1_list.length == C2_list.length, "Length mismatch");
//     for (uint i = 0; i < C1_list.length; i++) {
//         emit CipherTotalPublished(i + 1, C1_list[i], C2_list[i]);
//     }
// }
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

    struct PartialDecryption {
        uint256[2][] D_points;
        bool verified;
    }

    ElectionInfo public info;
    Candidate[] public candidates;
    bytes public epk;

    bytes32 public hashAllOnChain;
    address public aggregator;

    uint256 public thresholdCount;
    uint256 public constant minRequired = 2;

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

    function registerTrustees(address[3] calldata _trustees) external onlyAdmin {
        require(thresholdCount == 0, "Already initialized");

        for (uint256 i = 0; i < 3; i++) {
            isTrustee[_trustees[i]] = true;
            trusteeID[_trustees[i]] = i + 1;
            emit TrusteeRegistered(_trustees[i]);
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

        if (thresholdCount >= minRequired) {
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

        // emit VoteProofCombinedVerified(msg.sender, _nullifier, _hashCipherAll);
        emit VotePublished(_nullifier, _hashCipherAll, _cid);
    }

    bool public resultRevealed;

event ResultRevealed(uint indexed candidateId, uint voteCount);
event AllResultsRevealed(uint[] counts);

function revealResults(uint[] calldata counts) external onlyAdmin {
    // require(info.status == ElectionStatus.Ended, "Election not ended");
    require(thresholdCount >= minRequired, "Not enough partial decryptions");
    // require(!resultRevealed, "Results already revealed");
    require(counts.length == candidates.length, "Length mismatch");

    for (uint i = 0; i < counts.length; i++) {
        candidates[i].voteCount = counts[i];
        emit ResultRevealed(i + 1, counts[i]);
    }

    resultRevealed = true;
    emit AllResultsRevealed(counts);
}
}