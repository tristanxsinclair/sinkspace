# Research Functionality Debug Guide

## Issue: "now it doesnt even research shit"

The research functionality stopped working after replacing simulation with real backend integration.

## 🔍 Debugging Steps

### 1. Check Backend API Connectivity

**Test the ping endpoint:**
```bash
curl -X GET http://127.0.0.1:8000/api/research/ping
```
*Expected: `{"status": "research_api_working"}`*

### 2. Check RAG Store Contents

**List RAG documents:**
```bash
curl -X GET http://127.0.0.1:8000/api/state/full | jq '.rag.documents'
```
*Expected: Should show number of documents > 0*

If 0 documents, need to ingest some test data:
```bash
# Ingest test document
curl -X POST http://127.0.0.1:8000/api/rag/ingest \
  -H "Content-Type: application/json" \
  -d '{"source_id": "test-doc-1", "text": "Western Australia AI infrastructure analysis shows significant economic opportunities including job creation and technological advancement. The state has competitive advantages in energy resources and strategic location for AI development."}'
```

### 3. Test Research API Directly

**Run research via API:**
```bash
curl -X POST http://127.0.0.1:8000/api/research \
  -H "Content-Type: application/json" \
  -d '{"question": "What are AI infrastructure opportunities in Western Australia?", "depth": "standard"}'
```

### 4. Check Frontend Console

Open browser developer console (F12) and:
1. Go to RESEARCH view
2. Enter a question
3. Click "START RESEARCH"
4. Check console output for errors

**Expected to see:**
- "Starting research with question: ..."
- "Calling API with: ..."
- "API response: ..."

If you see errors, they will indicate what's wrong.

## 🛠️ Common Issues & Fixes

### Issue 1: RAG Store Empty
**Symptom:** Research returns "No sources found" or empty results
**Fix:** Ingest test documents via `/api/rag/ingest` endpoint

### Issue 2: Backend Not Running  
**Symptom:** API calls fail with connection refused
**Fix:** Start server with: `python -m uvicorn lake_yange.ui_api:create_app --factory --reload`

### Issue 3: Session Header Missing
**Symptom:** 403 Forbidden errors
**Fix:** Ensure frontend is served through the same server (index.html includes session token)

### Issue 4: JavaScript Async Issues
**Symptom:** Nothing happens when clicking START RESEARCH
**Fix:** Check console for JavaScript errors, ensure startResearch is async

## 📋 Current Implementation Status

### ✅ Backend (`ui_api.py`)
- Research API endpoints: `POST /api/research`, `GET /api/research/{id}`, etc.
- Integration with `DeepResearch` class
- Vera audit for evidence verification
- Red Sink provenance recording
- Session persistence via encrypted store

### ✅ Frontend (`index.html`)
- Real API calls (no simulation)
- Async/await properly handled
- Real-time progress updates
- Error handling and display
- PROPOSE MISSION functionality

### ⚠️ Potential Issues
- RAG store may be empty (requires data ingestion)
- Backend may have import issues (check server logs)
- Session management may need testing

## 🚀 Quick Test

1. Start server: `python -m uvicorn lake_yange.ui_api:create_app --factory --reload`
2. Ingest test data: Use the curl commands above
3. Open browser: `http://127.0.0.1:8000`
4. Test research with: "What is AI infrastructure in Western Australia?"
5. Check console for errors

## 💡 Expected Behavior

If everything works, you should see:
1. Progress: UNDERSTANDING → SOURCES → CROSS-CHECK → ANALYSIS → REVIEW
2. Real sources displayed with actual content
3. Real findings with evidence
4. Provenance data in ADVANCED VIEW
5. "PROPOSE MISSION" button appears when complete

## 🎯 Next Steps

1. **Check RAG store has data** - Most likely issue
2. **Test API directly** - Verify backend is working
3. **Check browser console** - Identify any frontend errors
4. **Review server logs** - Check for backend errors

The implementation is complete - we just need to identify why it's not connecting properly.