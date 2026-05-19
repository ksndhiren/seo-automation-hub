# Validation Scripts

These scripts verify that the current `.env` secrets are wired correctly without
printing the secret values.

Run them from the repo root:

```bash
python3 scripts/check_openai.py
python3 scripts/check_copyscape.py
python3 scripts/check_pexels.py
python3 scripts/check_neuronwriter.py
python3 scripts/check_all.py
```

## Notes

- `check_openai.py` sends a tiny Responses API request.
- `check_copyscape.py` calls the free `balance` endpoint and does not consume search credit.
- `check_pexels.py` fetches one curated photo.
- `check_neuronwriter.py` calls `list-projects`, which should not consume an analysis slot.

If OpenAI or Copyscape billing has not been funded yet, those scripts may still
prove that auth works while reporting a quota or zero-balance problem.
