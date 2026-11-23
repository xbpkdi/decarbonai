// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal JSON string escaping for on-chain metadata built from owner-supplied text.
library Json {
    bytes16 private constant HEX = "0123456789abcdef";

    /// @dev Escapes `"` and `\`, and encodes control characters (< 0x20) as \u00XX.
    function escape(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        uint256 extra;
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            if (c == '"' || c == "\\") extra += 1;
            else if (uint8(c) < 0x20) extra += 5;
        }
        if (extra == 0) return s;
        bytes memory out = new bytes(b.length + extra);
        uint256 j;
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            if (c == '"' || c == "\\") {
                out[j++] = "\\";
                out[j++] = c;
            } else if (uint8(c) < 0x20) {
                out[j++] = "\\";
                out[j++] = "u";
                out[j++] = "0";
                out[j++] = "0";
                out[j++] = HEX[uint8(c) >> 4];
                out[j++] = HEX[uint8(c) & 0x0f];
            } else {
                out[j++] = c;
            }
        }
        return string(out);
    }
}
