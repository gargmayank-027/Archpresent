"""
Business logic layer — the DXF -> IR -> themed SVG pipeline.

app/services/render_pipeline.py is the single entry point everything
else (parsing, classification, mapping, theming, SVG rendering) is
orchestrated behind; app/api/v1/endpoints/render.py is its only caller.
"""
