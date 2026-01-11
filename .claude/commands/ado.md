# Azure DevOps Command

Invoke ADO operations via subagent to isolate context cost.

## Usage

```
/ado [ID] [action]
/ado create [type] "[title]"
/ado search "[query]"
/ado export
```

## Operations

### Query Work Item
```
/ado 123 get status
/ado 123 get details
```

### Update Work Item
```
/ado 123 set state Active
/ado 123 set description "New description"
/ado 123 add tag "clustering"
```

### Create Work Item
```
/ado create "Add feature X"
/ado create story "Implement clustering"
/ado create bug "Fix duplicate articles"
/ado create epic "Clustering V2"
```

### Search
```
/ado search "clustering"
/ado search "tag:jira:TTRC-123"
```

### Bulk Operations
```
/ado export                     # Export all to scripts/ado-export.json
/ado count                      # Count all work items
/ado list stories               # List all User Stories
```

### Link Items
```
/ado 123 link parent 456        # Set parent
/ado 123 link child 789         # Add child
```

---

## Instance Details

- **Project:** TTracker
- **Work Item Types:** Epic, User Story, Bug, Task

---

## Type Rules

| If the work is... | Create a... |
|-------------------|-------------|
| Any dev work (add, implement, improve) | User Story |
| Something broken (fix, error, crash) | Bug |
| Grouping Stories (user says "epic") | Epic |
| Sub-item of a story | Task |

---

## Response Format

Subagent returns concise summary:
```
[ADO #123]: Feature Title
Type: User Story | State: Active
Tags: jira:TTRC-123, clustering
[Action: Updated state to Active]
```

Full API responses are absorbed by subagent (saves 99.5% context).
