// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Fixed-supply ERC-20 for Sepolia payment testing.
contract TestStablecoin {
    string public name;
    string public symbol;
    uint8 public constant decimals = 6;
    uint256 public immutable totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory tokenSymbol, address recipient, uint256 supply) {
        require(block.chainid == 11155111, "Sepolia only");
        require(recipient != address(0) && supply > 0, "Invalid mint");
        name = string.concat("PQPost Test ", tokenSymbol);
        symbol = tokenSymbol;
        totalSupply = supply;
        balanceOf[recipient] = supply;
        emit Transfer(address(0), recipient, supply);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        if (approved != type(uint256).max) {
            allowance[from][msg.sender] = approved - value;
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) private {
        require(from != address(0) && to != address(0), "Invalid transfer");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
