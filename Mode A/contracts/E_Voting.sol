// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./PartialDecryptionVerifier.sol";

contract E_Voting is PartialDecryptionVerifier {
    address public admin;

    enum ElectionStatus {
        Inactive,
        Active,
        Ended
    }

    struct ElectionInfo {
        string electionId;
        string name;
        uint startDate;
        uint endDate;
        ElectionStatus status;
        bytes32 merkleRoot;
    }

    struct Candidate {
        uint id;
        string name;
        uint voteCount;
    }

    ElectionInfo public info;
    Candidate[] public candidates;
    bytes public epk;
    uint256 public electionHash;
    uint256 public epkX;
    uint256 public epkY;
    bool public electionConfigured;
    bool public cryptoParamsConfigured;
    uint256 public constant SNARK_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    event ElectionCreated(string electionId, string name);
    event MerkleRootUpdated(bytes32 root);
    event CandidateAdded(uint id, string name);
    event EpkPublished(bytes epk);
    event ElectionCryptoParamsPublished(uint256 electionHash, uint256 epkX, uint256 epkY);
    event ElectionStarted();
    event VotePublished(
        bytes32 indexed nullifier,
        bytes32 indexed hashCipher,
        string cid
    );
    constructor() {
        admin = msg.sender;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not authorized");
        _;
    }

    modifier onlyActiveElection() {
        require(info.status == ElectionStatus.Active, "Election not active");
        _;
    }

    modifier onlyConfiguration() {
        require(info.status == ElectionStatus.Inactive, "Election configuration locked");
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

    function setElectionInfo(
        string memory _id,
        string memory _name,
        uint _start,
        uint _end
    ) public onlyAdmin onlyConfiguration {
        require(!electionConfigured, "Election already configured");
        require(bytes(_id).length > 0 && _end > _start, "Invalid election info");
        electionConfigured = true;
        info = ElectionInfo(
            _id,
            _name,
            _start,
            _end,
            ElectionStatus.Inactive,
            0x0
        );
        emit ElectionCreated(_id, _name);
    }

    event ElectionEnded();

    function startElection() external onlyAdmin onlyConfiguration {
        require(electionConfigured && cryptoParamsConfigured, "Election not configured");
        require(info.merkleRoot != bytes32(0), "Merkle root not configured");
        require(candidates.length > 0, "No candidates");
        info.status = ElectionStatus.Active;
        emit ElectionStarted();
    }

    function setElectionCryptoParams(
        uint256 _electionHash,
        uint256 _epkX,
        uint256 _epkY
    ) external onlyAdmin onlyConfiguration {
        require(_electionHash > 0 && _electionHash < SNARK_SCALAR_FIELD, "Invalid election hash");
        electionHash = _electionHash;
        _setEpk(_epkX, _epkY);
        cryptoParamsConfigured = true;
        emit ElectionCryptoParamsPublished(_electionHash, _epkX, _epkY);
    }

    function _setEpk(uint256 _epkX, uint256 _epkY) internal {
        require(_epkX < SNARK_SCALAR_FIELD && _epkY < SNARK_SCALAR_FIELD, "Invalid public key");
        require(_epkX != 0 || _epkY != 1, "Identity public key");
        epkX = _epkX;
        epkY = _epkY;
        epk = abi.encode(_epkX, _epkY);
        emit EpkPublished(epk);
    }

    function endElection() external onlyAdmin {
        require(info.status == ElectionStatus.Active, "Not active");
        info.status = ElectionStatus.Ended;
        emit ElectionEnded();
    }

    function setMerkleRoot(bytes32 _root) external onlyAdmin onlyConfiguration {
        require(uint256(_root) > 0 && uint256(_root) < SNARK_SCALAR_FIELD, "Invalid Merkle root");
        info.merkleRoot = _root;
        emit MerkleRootUpdated(_root);
    }

    function addCandidate(string memory _name) public onlyAdmin onlyConfiguration {
        candidates.push(Candidate(candidates.length + 1, _name, 0));
        emit CandidateAdded(candidates.length, _name);
    }

    function publishEpk(bytes calldata _epk) external onlyAdmin onlyConfiguration {
        require(_epk.length == 64, "Expected ABI encoded public key");
        (uint256 x, uint256 y) = abi.decode(_epk, (uint256, uint256));
        _setEpk(x, y);
    }

    function getCandidateCount() public view returns (uint) {
        return candidates.length;
    }

    mapping(bytes32 => bool) public isNullifierUsed;

    function submitVote(
        bytes32 _nullifier,
        bytes32 _hashCipher,
        string calldata _cid
    ) external onlyActiveElection onlyAdmin {
        require(!isNullifierUsed[_nullifier], "Double vote detected");

        isNullifierUsed[_nullifier] = true;

        emit VotePublished(_nullifier, _hashCipher, _cid);
    }

    bytes32 public hashAllOnChain;
    event HashAllOnChainPublished(bytes32 hashAllOnChain);

    function publishHashAllOnChain(bytes32 _hashAllOnChain) external onlyAdmin {
        require(hashAllOnChain == 0x0, "Already published");
        hashAllOnChain = _hashAllOnChain;
        emit HashAllOnChainPublished(_hashAllOnChain);
    }

    // Aggregator nộp kết quả tổng hợp
    //bytes public finalCipher;
    //bytes32 public tallyProofHash;
    //event TallySubmitted(bytes C_total, bytes32 proofHash);

    //function submitTally(bytes calldata _C_total, bytes32 _proofHash) external onlyAdmin {
    //    require(hashOnChain != 0x0, "hashOnChain not set");
    //    finalCipher = _C_total;
    //    tallyProofHash = _proofHash;
    //    emit TallySubmitted(_C_total, _proofHash);
    //}

    struct PartialDecryption {
        uint256[2][] D_points;
        bool verified;
    }
    //mapping(address => PartialDecryption) public partialDecryptions;

    mapping(address => bool) public isTrustee;
    mapping(address => uint256) public trusteeID;

    uint256 public thresholdCount;
    uint256 public constant minRequired = 2; // 2/3 in 3 trustee

    // Event
    event TrusteeRegistered(address indexed trustee);
    event PartialDecryptionVerified(address indexed trustee);
    event PartialDecryptionSubmitted(
        address indexed trustee,
        uint256[2][] D_points
    );
    event AllTrusteesAgreed();

    function registerTrustees(
        address[3] calldata _trustees
    ) external onlyAdmin {
        require(thresholdCount == 0, "Already initialized");
        for (uint i = 0; i < 3; i++) {
            isTrustee[_trustees[i]] = true;
            trusteeID[_trustees[i]] = i + 1;
            emit TrusteeRegistered(_trustees[i]);
        }
    }

    mapping(address => bool) public lastVerifyPassed;
    event PartialDecryptionFailed(address trustee);

    // function verifyPartialProof(
    //     uint[2] calldata pA,
    //     uint[2][2] calldata pB,
    //     uint[2] calldata pC,
    //     uint[1] calldata pubSignals
    // ) external onlyTrustee returns (bool) {

    //     bool ok = _safeVerifyPartialProof(pA, pB, pC, pubSignals); // dùng wrapper

    //     if (ok) {
    //         lastVerifyPassed[msg.sender] = true;
    //         emit PartialDecryptionVerified(msg.sender);
    //     } else {
    //         emit PartialDecryptionFailed(msg.sender);
    //     }

    //     return ok;
    // }

    function verifyPartialProof(
        uint[2] calldata pA,
        uint[2][2] calldata pB,
        uint[2] calldata pC,
        uint[1] calldata pubSignals
    ) external onlyTrustee {
        bool ok = _safeVerifyPartialProof(pA, pB, pC, pubSignals);
        require(ok, "Invalid ZK Proof");
        lastVerifyPassed[msg.sender] = true;
        emit PartialDecryptionVerified(msg.sender);
    }

    function _safeVerifyPartialProof(
        uint[2] memory pA,
        uint[2][2] memory pB,
        uint[2] memory pC,
        uint[1] memory pubSignals
    ) internal view returns (bool) {
        (bool success, bytes memory result) = address(this).staticcall(
            abi.encodeWithSignature(
                "verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[1])",
                pA,
                pB,
                pC,
                pubSignals
            )
        );
        if (!success || result.length < 32) return false;
        return abi.decode(result, (bool));
    }

    mapping(address => bool) public hasPublished;

    function publishPartialDecryption(
        uint256[2][] calldata D_points
    ) external onlyTrustee {
        require(lastVerifyPassed[msg.sender], "Proof not verified");
        //require(!partialDecryptions[msg.sender].verified, "Already submitted");
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

    address public aggregator;

    event CipherTotalPublished(
        uint indexed candidateId,
        uint[2] C1_total,
        uint[2] C2_total
    );

    function setAggregator(address _aggregator) external onlyAdmin {
        require(_aggregator != address(0), "invalid aggregator");
        aggregator = _aggregator;
    }

    function publishAllCipherTotals(
        uint[2][] calldata C1_list,
        uint[2][] calldata C2_list
    ) external onlyAggregator {
        require(C1_list.length == C2_list.length, "Length mismatch");
        for (uint i = 0; i < C1_list.length; i++) {
            emit CipherTotalPublished(i + 1, C1_list[i], C2_list[i]);
        }
    }

    bool public resultRevealed;

    event ResultRevealed(uint indexed candidateId, uint voteCount);
    event AllResultsRevealed(uint[] counts);

    function revealResults(uint[] calldata counts) external onlyAdmin {
        // require(info.status == ElectionStatus.Ended, "Election not ended");
        require(
            thresholdCount >= minRequired,
            "Not enough partial decryptions"
        );
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
