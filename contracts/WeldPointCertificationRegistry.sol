// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Immutable submissions and CRE results. Deploy a separate instance for simulation.
contract WeldPointCertificationRegistry {
    struct Certificate {
        bytes32 commitment;
        bool valid;
        uint32 steps;
        bool exists;
    }
    address public immutable owner;
    address public immutable forwarder;
    bytes32 public immutable workflowId;
    bool public immutable simulation;
    mapping(bytes32 => bytes32) public requests;
    mapping(bytes32 => Certificate) public certifications;
    event SubmissionRegistered(bytes32 indexed id, bytes32 commitment);
    event Certified(bytes32 indexed id, bytes32 commitment, bool valid, uint32 steps);

    constructor(address forwarder_, bytes32 workflowId_, bool simulation_) {
        require(block.chainid == 11155111, 'Sepolia only');
        require(forwarder_ != address(0) && forwarder_.code.length > 0, 'Invalid forwarder');
        require(simulation_ || workflowId_ != bytes32(0), 'Workflow identity required');
        owner = msg.sender;
        forwarder = forwarder_;
        workflowId = workflowId_;
        simulation = simulation_;
    }
    function registerSubmission(bytes32 id, bytes32 commitment) external {
        require(msg.sender == owner, 'Only submitter');
        require(id != bytes32(0) && commitment != bytes32(0), 'Empty submission');
        bytes32 prior = requests[id];
        require(prior == bytes32(0) || prior == commitment, 'Submission is immutable');
        if (prior == bytes32(0)) {
            requests[id] = commitment;
            emit SubmissionRegistered(id, commitment);
        }
    }
    function onReport(bytes calldata metadata, bytes calldata report) external {
        require(msg.sender == forwarder, 'Only forwarder');
        if (!simulation) {
            require(metadata.length == 62, 'Invalid metadata');
            bytes32 actualId;
            assembly {
                actualId := calldataload(metadata.offset)
            }
            require(actualId == workflowId, 'Wrong workflow');
        }
        (
            bytes32 id,
            bytes32 commitment,
            bool valid,
            uint32 steps,
            uint256 chainId,
            address receiver
        ) = abi.decode(report, (bytes32, bytes32, bool, uint32, uint256, address));
        require(chainId == block.chainid && receiver == address(this), 'Wrong destination');
        require(commitment != bytes32(0) && requests[id] == commitment, 'Unregistered submission');
        require(steps <= 32 && (!valid || steps > 0), 'Invalid turn count');
        Certificate memory prior = certifications[id];
        if (prior.exists) {
            require(
                prior.commitment == commitment && prior.valid == valid && prior.steps == steps,
                'Certificate is immutable'
            );
            return;
        }
        certifications[id] = Certificate(commitment, valid, steps, true);
        emit Certified(id, commitment, valid, steps);
    }
    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == this.onReport.selector;
    }
}
