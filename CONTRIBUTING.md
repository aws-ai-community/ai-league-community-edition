# Contributing to AWS AI League - Community Edition

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to this project.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Install dependencies: `npm install`
4. Create a feature branch: `git checkout -b feature/your-feature-name`

## Development Setup

### Prerequisites

- Node.js 22+
- AWS CLI configured with valid credentials
- AWS CDK CLI (`npm install -g aws-cdk`)
- Docker (for CDK bundling fallback)

### Running Locally

After deploying the backend at least once:

```bash
# Download runtime config from your deployed app
curl https://<your-cloudfront-domain>/aws-exports.json -o frontend/public/aws-exports.json

# Start the frontend dev server
cd frontend
npm install
npm run dev
```

The app runs at `http://localhost:5173` with hot reload.

### Running Tests

```bash
# Run all tests (unit + property-based)
npm test

# Run tests in watch mode during development
npx vitest
```

## Project Conventions

### Code Style

- TypeScript strict mode throughout
- Functional React components with hooks (no class components)
- CloudScape Design System components for all UI elements
- Exact pinned dependency versions in package.json (no ranges)

### File Organization

- **Frontend components**: `frontend/src/components/`
- **React contexts**: `frontend/src/contexts/`
- **Service modules**: `frontend/src/services/`
- **Lambda handlers**: `lambda/<function-name>/index.ts`
- **CDK infrastructure**: `infrastructure/lib/`
- **Unit tests**: `tests/unit/`
- **Property-based tests**: `tests/property/`

### Naming Conventions

- Components: PascalCase (`ProfilePage.tsx`)
- Services/utilities: camelCase (`profileService.ts`)
- Test files: `<component-name>.test.ts` or `<property-name>.property.ts`
- Lambda directories: kebab-case (`admin-seed/`, `profile-api/`)

### Testing

- Write unit tests for new components and handlers
- Write property-based tests for validation logic and data transformations
- Use `vitest` as the test runner
- Use `fast-check` for property-based tests (minimum 100 iterations)
- Use `@testing-library/react` for component tests
- Mock external dependencies (AWS SDK, fetch, localStorage)

### Commits

- Use clear, descriptive commit messages
- Keep commits focused on a single change
- Reference issue numbers where applicable

## Making Changes

### Frontend Changes

1. Add/modify components in `frontend/src/components/`
2. Add corresponding tests in `tests/unit/`
3. Verify the build: `cd frontend && npx vite build`
4. Run tests: `npm test`

### Backend Changes (Lambda)

1. Modify handlers in `lambda/<function-name>/index.ts`
2. Add corresponding tests in `tests/unit/`
3. Verify TypeScript compiles: `npx tsc --noEmit --project lambda/tsconfig.json`
4. Run tests: `npm test`

### Infrastructure Changes

1. Modify the CDK stack in `infrastructure/lib/cdk-stack.ts`
2. Verify TypeScript compiles: `npx tsc --noEmit --project infrastructure/tsconfig.json`
3. Preview changes: `npx cdk diff`
4. Deploy to a test environment before submitting PR

## Pull Request Process

1. Ensure all tests pass: `npm test`
2. Ensure TypeScript compiles without errors in all workspaces
3. Ensure the frontend builds: `cd frontend && npx vite build`
4. Update documentation if your change affects the user experience or deployment
5. Submit a pull request with a clear description of the changes

### PR Description Template

```
## What

Brief description of the change.

## Why

Motivation for the change.

## How

Technical approach taken.

## Testing

How the change was tested.
```

## Adding New Features

When adding a new feature:

1. Update the requirements document if acceptance criteria change
2. Update the design document if architecture changes
3. Add the feature implementation
4. Add tests (unit + property-based where applicable)
5. Update the README if user-facing behavior changes

## Reporting Issues

- Use GitHub Issues to report bugs or request features
- Include steps to reproduce for bugs
- Include expected vs actual behavior
- Include relevant error messages or screenshots

## Code of Conduct

Be respectful, inclusive, and constructive in all interactions. We're all here to build something great for the AWS AI League community.
