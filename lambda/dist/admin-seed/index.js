"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_cognito_identity_provider_1 = require("@aws-sdk/client-cognito-identity-provider");
const crypto_1 = require("crypto");
const client = new client_cognito_identity_provider_1.CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@aileague.community";
const ADMIN_GROUP = "admin";
/**
 * Generates a secure password that meets Cognito password policy:
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one digit
 * - At least one special character
 */
function generateSecurePassword() {
    const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const lowercase = "abcdefghijklmnopqrstuvwxyz";
    const digits = "0123456789";
    const special = "!@#$%^&*()-_=+[]{}|;:,.<>?";
    const allChars = uppercase + lowercase + digits + special;
    // Ensure at least one character from each required category
    const required = [
        uppercase[(0, crypto_1.randomBytes)(1)[0] % uppercase.length],
        lowercase[(0, crypto_1.randomBytes)(1)[0] % lowercase.length],
        digits[(0, crypto_1.randomBytes)(1)[0] % digits.length],
        special[(0, crypto_1.randomBytes)(1)[0] % special.length],
    ];
    // Fill remaining characters (16 total for strong password)
    const remaining = [];
    const bytes = (0, crypto_1.randomBytes)(12);
    for (let i = 0; i < 12; i++) {
        remaining.push(allChars[bytes[i] % allChars.length]);
    }
    // Shuffle all characters together using Fisher-Yates
    const password = [...required, ...remaining];
    const shuffleBytes = (0, crypto_1.randomBytes)(password.length);
    for (let i = password.length - 1; i > 0; i--) {
        const j = shuffleBytes[i] % (i + 1);
        [password[i], password[j]] = [password[j], password[i]];
    }
    return password.join("");
}
/**
 * Checks if the admin user already exists in the User Pool.
 * Returns true if the user exists, false otherwise.
 */
async function adminUserExists() {
    try {
        await client.send(new client_cognito_identity_provider_1.AdminGetUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: ADMIN_EMAIL,
        }));
        return true;
    }
    catch (error) {
        const name = error instanceof Error ? error.name : '';
        if (name === 'UserNotFoundException') {
            return false;
        }
        throw error;
    }
}
/**
 * Ensures the admin group exists in the User Pool.
 * Creates it if it doesn't exist; ignores GroupExistsException.
 */
async function ensureGroupExists() {
    try {
        await client.send(new client_cognito_identity_provider_1.CreateGroupCommand({
            UserPoolId: USER_POOL_ID,
            GroupName: ADMIN_GROUP,
            Description: "Administrator group with full access",
        }));
    }
    catch (error) {
        const name = error instanceof Error ? error.name : '';
        if (name === 'GroupExistsException') {
            // Group already exists, nothing to do
            return;
        }
        throw error;
    }
}
/**
 * Creates the admin user, sets a permanent password, and adds to the admin group.
 * Returns the generated password.
 */
async function createAdminUser() {
    const password = generateSecurePassword();
    // Create the user with a temporary password (suppressing welcome email)
    await client.send(new client_cognito_identity_provider_1.AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: ADMIN_EMAIL,
        UserAttributes: [
            { Name: "email", Value: ADMIN_EMAIL },
            { Name: "email_verified", Value: "true" },
        ],
        MessageAction: "SUPPRESS",
    }));
    // Set a permanent password so the user can log in immediately
    await client.send(new client_cognito_identity_provider_1.AdminSetUserPasswordCommand({
        UserPoolId: USER_POOL_ID,
        Username: ADMIN_EMAIL,
        Password: password,
        Permanent: true,
    }));
    // Ensure the admin group exists before adding the user
    await ensureGroupExists();
    // Add the user to the admin group
    await client.send(new client_cognito_identity_provider_1.AdminAddUserToGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: ADMIN_EMAIL,
        GroupName: ADMIN_GROUP,
    }));
    return password;
}
const handler = async (event) => {
    const baseResponse = {
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        PhysicalResourceId: event.LogicalResourceId,
    };
    try {
        switch (event.RequestType) {
            case "Create": {
                const exists = await adminUserExists();
                if (exists) {
                    console.log("Admin user already exists, skipping creation.");
                    return {
                        ...baseResponse,
                        Status: "SUCCESS",
                        Data: {
                            AdminPassword: "EXISTING_USER_NOT_MODIFIED",
                            Message: "Admin user already exists, no mutations performed.",
                        },
                    };
                }
                console.log("Creating admin user...");
                const password = await createAdminUser();
                console.log("Admin user created successfully.");
                return {
                    ...baseResponse,
                    Status: "SUCCESS",
                    Data: {
                        AdminPassword: password,
                        Message: "Admin user created successfully.",
                    },
                };
            }
            case "Update": {
                console.log("Update event received, no-op.");
                return {
                    ...baseResponse,
                    Status: "SUCCESS",
                    Data: {
                        AdminPassword: "NO_CHANGE_ON_UPDATE",
                        Message: "Update is a no-op for admin seed.",
                    },
                };
            }
            case "Delete": {
                console.log("Delete event received, no-op (admin user retained).");
                return {
                    ...baseResponse,
                    Status: "SUCCESS",
                    Data: {
                        AdminPassword: "NO_CHANGE_ON_DELETE",
                        Message: "Delete is a no-op, admin user retained.",
                    },
                };
            }
            default: {
                return {
                    ...baseResponse,
                    Status: "SUCCESS",
                    Data: {},
                };
            }
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Admin seed handler failed:", message);
        return {
            ...baseResponse,
            Status: "FAILED",
            Reason: `Admin seed failed: ${message}`,
            Data: {},
        };
    }
};
exports.handler = handler;
//# sourceMappingURL=index.js.map