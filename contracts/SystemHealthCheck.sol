// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/IAccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title SystemHealthCheck
 * @notice Read-only contract that verifies all cross-contract wiring is correct.
 *         Returns a structured health report in a single RPC call.
 */

interface ITokenHealth {
    function identityRegistry() external view returns (address);
    function compliance() external view returns (address);
    function paused() external view returns (bool);
    function totalSupply() external view returns (uint256);
}

interface IRegistryHealth {
    function identityFactory() external view returns (address);
}

interface IComplianceHealth {
    function complianceOracle() external view returns (address);
}

interface IMultiSigWarm {
    function isSigner(address) external view returns (bool);
}

contract SystemHealthCheck {

    struct CheckResult {
        string name;
        bool   passed;
        string detail;
    }

    struct HealthReport {
        uint256 timestamp;
        uint256 blockNumber;
        uint256 totalChecks;
        uint256 passedChecks;
        uint256 failedChecks;
        bool    healthy;
    }

    /// @dev Pack all addresses into a struct to avoid stack-too-deep.
    struct Addresses {
        address identityRegistry;
        address compliance;
        address securityToken;
        address cashToken;
        address dvpSettlement;
        address tokenFactory;
        address identityFactory;
        address governor;
        address timelock;
        address walletRegistry;
        address multiSigWarm;
        address expectedAdmin;
    }

    function _isContract(address addr) internal view returns (bool) {
        return addr != address(0) && addr.code.length > 0;
    }

    // ── Public entry point ──────────────────────────────────────────

    function fullHealthCheck(
        Addresses calldata a
    ) external view returns (HealthReport memory report, CheckResult[] memory results) {
        results = new CheckResult[](20);
        uint256 passed = 0;

        passed += _checkWiring(a, results);
        passed += _checkAdminRoles(a, results);
        passed += _checkOperational(a, results);
        passed += _checkDeployment(a, results);

        uint256 total = 20;
        report = HealthReport({
            timestamp:    block.timestamp,
            blockNumber:  block.number,
            totalChecks:  total,
            passedChecks: passed,
            failedChecks: total - passed,
            healthy:      (passed == total)
        });
    }

    // ── Batch 1: Wiring checks (4 checks, indices 0-3) ─────────────

    function _checkWiring(
        Addresses calldata a,
        CheckResult[] memory results
    ) internal view returns (uint256 passed) {
        // 1. Token -> IdentityRegistry wiring
        {
            bool ok;
            if (_isContract(a.securityToken)) {
                try ITokenHealth(a.securityToken).identityRegistry() returns (address reg) {
                    ok = (reg == a.identityRegistry);
                } catch { ok = false; }
            }
            results[0] = CheckResult("Token -> IdentityRegistry wiring", ok, ok ? "Correct" : "MISMATCH");
            if (ok) passed++;
        }

        // 2. Token -> Compliance wiring
        {
            bool ok;
            if (_isContract(a.securityToken)) {
                try ITokenHealth(a.securityToken).compliance() returns (address comp) {
                    ok = (comp == a.compliance);
                } catch { ok = false; }
            }
            results[1] = CheckResult("Token -> Compliance wiring", ok, ok ? "Correct" : "MISMATCH");
            if (ok) passed++;
        }

        // 3. Registry -> IdentityFactory wiring
        {
            bool ok;
            if (_isContract(a.identityRegistry)) {
                try IRegistryHealth(a.identityRegistry).identityFactory() returns (address fac) {
                    ok = (fac == a.identityFactory);
                } catch { ok = false; }
            }
            results[2] = CheckResult("Registry -> IdentityFactory wiring", ok, ok ? "Correct" : "MISMATCH");
            if (ok) passed++;
        }

        // 4. Compliance oracle configured
        {
            bool ok;
            if (_isContract(a.compliance)) {
                try IComplianceHealth(a.compliance).complianceOracle() returns (address oracle) {
                    ok = (oracle != address(0));
                } catch { ok = false; }
            }
            results[3] = CheckResult("Compliance oracle configured", ok, ok ? "Set" : "ZERO ADDRESS");
            if (ok) passed++;
        }
    }

    // ── Batch 2: Admin role checks (6 checks, indices 4-9) ─────────

    function _checkAdminRoles(
        Addresses calldata a,
        CheckResult[] memory results
    ) internal view returns (uint256 passed) {
        bytes32 adminRole = bytes32(0);

        address[6] memory targets = [
            a.identityRegistry,
            a.securityToken,
            a.compliance,
            a.dvpSettlement,
            a.tokenFactory,
            a.walletRegistry
        ];

        string[6] memory names = [
            "IdentityRegistry admin",
            "SecurityToken admin",
            "Compliance admin",
            "DvPSettlement admin",
            "TokenFactory admin",
            "WalletRegistry admin"
        ];

        for (uint256 i = 0; i < 6; i++) {
            bool ok;
            if (_isContract(targets[i])) {
                try IAccessControl(targets[i]).hasRole(adminRole, a.expectedAdmin) returns (bool has) {
                    ok = has;
                } catch { ok = false; }
            }
            results[4 + i] = CheckResult(names[i], ok, ok ? "Correct admin" : "Admin missing");
            if (ok) passed++;
        }
    }

    // ── Batch 3: Operational checks (5 checks, indices 10-14) ───────

    function _checkOperational(
        Addresses calldata a,
        CheckResult[] memory results
    ) internal view returns (uint256 passed) {
        // 10. OPERATOR_ROLE on DvP
        {
            bytes32 operatorRole = keccak256("OPERATOR_ROLE");
            bool ok;
            if (_isContract(a.dvpSettlement)) {
                try IAccessControl(a.dvpSettlement).hasRole(operatorRole, a.expectedAdmin) returns (bool has) {
                    ok = has;
                } catch { ok = false; }
            }
            results[10] = CheckResult("DvPSettlement operator role", ok, ok ? "Set" : "No operator");
            if (ok) passed++;
        }

        // 11. TOKEN_ROLE on Compliance for SecurityToken
        {
            bytes32 tokenRole = keccak256("TOKEN_ROLE");
            bool ok;
            if (_isContract(a.compliance)) {
                try IAccessControl(a.compliance).hasRole(tokenRole, a.securityToken) returns (bool has) {
                    ok = has;
                } catch { ok = false; }
            }
            results[11] = CheckResult("Compliance TOKEN_ROLE -> Token", ok, ok ? "Granted" : "MISSING");
            if (ok) passed++;
        }

        // 12. Token not paused
        {
            bool ok;
            if (_isContract(a.securityToken)) {
                try ITokenHealth(a.securityToken).paused() returns (bool isPaused) {
                    ok = !isPaused;
                } catch { ok = false; }
            }
            results[12] = CheckResult("SecurityToken not paused", ok, ok ? "Active" : "PAUSED");
            if (ok) passed++;
        }

        // 13. Token has supply
        {
            bool ok;
            if (_isContract(a.securityToken)) {
                try ITokenHealth(a.securityToken).totalSupply() returns (uint256 supply) {
                    ok = (supply > 0);
                } catch { ok = false; }
            }
            results[13] = CheckResult("SecurityToken has supply", ok, ok ? "Has supply" : "Zero supply");
            if (ok) passed++;
        }

        // 14. Cash token has supply
        {
            bool ok;
            if (_isContract(a.cashToken)) {
                try IERC20(a.cashToken).totalSupply() returns (uint256 supply) {
                    ok = (supply > 0);
                } catch { ok = false; }
            }
            results[14] = CheckResult("CashToken has supply", ok, ok ? "Has supply" : "Zero supply");
            if (ok) passed++;
        }
    }

    // ── Batch 4: Deployment checks (5 checks, indices 15-19) ────────

    function _checkDeployment(
        Addresses calldata a,
        CheckResult[] memory results
    ) internal view returns (uint256 passed) {
        // 15. MultiSigWarm signer (uses custom isSigner, not AccessControl)
        {
            bool ok;
            if (_isContract(a.multiSigWarm)) {
                try IMultiSigWarm(a.multiSigWarm).isSigner(a.expectedAdmin) returns (bool isSgn) {
                    ok = isSgn;
                } catch { ok = false; }
            }
            results[15] = CheckResult("MultiSigWarm signer role", ok, ok ? "Is signer" : "Not a signer");
            if (ok) passed++;
        }

        // 16. Governor deployed
        {
            bool ok = _isContract(a.governor);
            results[16] = CheckResult("Governor deployed", ok, ok ? "Deployed" : "Not found");
            if (ok) passed++;
        }

        // 17. Timelock deployed
        {
            bool ok = _isContract(a.timelock);
            results[17] = CheckResult("Timelock deployed", ok, ok ? "Deployed" : "Not found");
            if (ok) passed++;
        }

        // 18. IdentityFactory deployed
        {
            bool ok = _isContract(a.identityFactory);
            results[18] = CheckResult("IdentityFactory deployed", ok, ok ? "Deployed" : "Not found");
            if (ok) passed++;
        }

        // 19. PAUSER_ROLE on DvP
        {
            bytes32 pauserRole = keccak256("PAUSER_ROLE");
            bool ok;
            if (_isContract(a.dvpSettlement)) {
                try IAccessControl(a.dvpSettlement).hasRole(pauserRole, a.expectedAdmin) returns (bool has) {
                    ok = has;
                } catch { ok = false; }
            }
            results[19] = CheckResult("DvPSettlement pauser role", ok, ok ? "Set" : "No pauser");
            if (ok) passed++;
        }
    }
}
