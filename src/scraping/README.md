# India UI Scraper Demo

This scraper is built for a low-budget India-only MVP:

- real Indian IP by default
- persistent logged-in browser profiles
- headed browser by default
- ChatGPT, Gemini, and Perplexity UI adapters
- screenshots saved for every successful or failed run
- one job at a time, with delay support for batch runs

## 1. Log in once per engine

```powershell
src\scraping\venv\Scripts\python src\scraping\login.py --engine chatgpt
src\scraping\venv\Scripts\python src\scraping\login.py --engine gemini
src\scraping\venv\Scripts\python src\scraping\login.py --engine perplexity
```

Each command opens a visible browser. Log in manually, wait until the chat UI is usable, then press ENTER in the terminal.
For Gemini and Perplexity, the login command opens your installed Google Chrome because Google often rejects Playwright Chromium sign-in.

Profiles are saved in:

```text
src/scraping/browser_profiles/
```

## 2. Run one demo prompt

```powershell
src\scraping\venv\Scripts\python src\scraping\batch_demo.py --engine chatgpt --prompt "What are the best CRM tools for Indian startups? Keep it brief."
```

Use a specific browser profile:

```powershell
src\scraping\venv\Scripts\python src\scraping\batch_demo.py --engine perplexity --profile perplexity_chrome_1 --prompt "What are the best CRM tools for Indian startups? Keep it brief."
```

## 3. Run a small multi-engine demo

```powershell
src\scraping\venv\Scripts\python src\scraping\batch_demo.py --prompt "What are the best CRM tools for Indian startups? Keep it brief." --engine chatgpt --engine gemini --engine perplexity --min-delay 30 --max-delay 90
```

Screenshots and JSON results are saved in:

```text
src/scraping/results/
```

## 4. Start the API

From `src/scraping`:

```powershell
venv\Scripts\python -m uvicorn chatgpt_scraper:app --host 0.0.0.0 --port 8000 --reload
```

Health check:

```powershell
Invoke-RestMethod -Uri "http://localhost:8000/health"
```

Single engine:

```powershell
Invoke-RestMethod -Uri "http://localhost:8000/scrape/chatgpt" -Method POST -ContentType "application/json" -Body '{"prompt":"What are the best CRM tools for Indian startups? Keep it brief.","country_code":"IN"}'
```

Batch:

```powershell
Invoke-RestMethod -Uri "http://localhost:8000/scrape/batch" -Method POST -ContentType "application/json" -Body '{"prompts":["What are the best CRM tools for Indian startups? Keep it brief."],"engines":["chatgpt","gemini","perplexity"],"min_delay_seconds":30,"max_delay_seconds":90}'
```
