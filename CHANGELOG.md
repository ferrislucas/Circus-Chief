# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Fixed "no such table: main.model_providers" error when deleting projects
- Added cleanup to drop legacy `model_providers` table if it exists
- Drops both `model_providers` and `provider_models` tables before running schema to handle development databases

### Changes

- Simplified database initialization to clean up legacy tables from development
