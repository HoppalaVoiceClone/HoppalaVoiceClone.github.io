# Echo

A minimal voice cloning and voice design interface powered by the OmniVoice Hugging Face Space API and hosted on GitHub Pages.

## Features

- Upload a reference file or record one with the microphone
- Reference transcript, language and voice direction controls
- Speed, fixed duration, inference steps, CFG, denoise and trimming settings
- Design a new voice with gender, age, pitch, style, accent and dialect
- Automatically loads 600+ languages from the OmniVoice API contract
- Responsive, install-free static site

## Deployment

The `.github/workflows/pages.yml` workflow deploys the site to GitHub Pages when the repository is pushed. In repository settings, set **Settings → Pages → Source** to **GitHub Actions**.

> This interface uses the community `k2-fsa/OmniVoice` Space. Service load, quotas and upstream model changes can affect availability.
