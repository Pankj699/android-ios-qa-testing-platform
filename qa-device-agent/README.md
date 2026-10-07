# QA Device Agent (Phase 1)

Cross-platform local Device Agent for Centralized QA Platform.
Supports Windows & macOS.

## Quick Start

### 1. Pair Agent with Central QA Server
```bash
python src/main.py pair --server https://qa.example.com:8080 --code 123456
```

### 2. Start Agent Daemon
```bash
python src/main.py start
```

### 3. Check Status
```bash
python src/main.py status
```

### 4. Run System Diagnostics
```bash
python src/main.py diagnose
```

### 5. Unpair
```bash
python src/main.py unpair
```
