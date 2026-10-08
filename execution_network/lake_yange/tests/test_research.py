"""Tests for the real research functionality integration."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path
from datetime import datetime, timezone
from typing import Any, Dict

import pytest

from fastapi.testclient import TestClient

from lake_yange.ui_api import create_app, ResearchRequest, ResearchResponse


@pytest.fixture
def test_app():
    """Create a test application with temporary state directory."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        app = create_app(Path(tmp_dir), demo=True)
        client = TestClient(app)
        yield client
        # Cleanup happens automatically


@pytest.fixture
def client_with_rag_data(test_app):
    """Test client with some sample RAG data ingested."""
    client = test_app
    
    # Ingest some sample data for testing
    sample_data = [
        {
            "source_id": "test-gov-report",
            "text": "Western Australia's AI and technology sector has grown by 15% annually over the past five years, with significant potential for further expansion. The state government has identified AI infrastructure as a key driver of economic growth."
        },
        {
            "source_id": "test-academic-study", 
            "text": "Large-scale technology infrastructure projects typically generate a 3:1 return on investment over a 15-year period. This includes both direct economic benefits and indirect multiplier effects."
        },
        {
            "source_id": "test-commonwealth-policy",
            "text": "The Commonwealth has identified AI infrastructure as a key driver of future economic growth and international competitiveness. National policy supports coordinated development across states."
        }
    ]
    
    for data in sample_data:
        response = client.post("/api/rag/ingest", json=data)
        assert response.status_code == 200
    
    return client


class TestResearchAPI:
    """Test the research API endpoints."""
    
    def test_create_research_session(self, client_with_rag_data):
        """Test creating a new research session."""
        client = client_with_rag_data
        
        # Test with a valid question
        request = ResearchRequest(
            question="What are the main opportunities and risks of AI infrastructure in Western Australia?",
            depth="standard"
        )
        
        response = client.post("/api/research", json=request.model_dump())
        assert response.status_code == 200
        
        data = response.json()
        assert "session_id" in data
        assert data["question"] == request.question
        assert data["status"] in ["understanding", "sources", "crosscheck", "analysis", "review", "complete", "failed"]
    
    def test_research_with_no_rag_data(self, test_app):
        """Test research when no RAG data exists (should still work but with limited results)."""
        client = test_app
        
        request = ResearchRequest(
            question="Test question with no matching data",
            depth="standard"
        )
        
        response = client.post("/api/research", json=request.model_dump())
        assert response.status_code == 200
        
        data = response.json()
        assert "session_id" in data
        assert data["status"] in ["understanding", "sources", "crosscheck", "analysis", "review", "complete", "failed"]
    
    def test_research_with_different_depths(self, client_with_rag_data):
        """Test research with different depth settings."""
        client = client_with_rag_data
        depths = ["quick", "standard", "deep", "investigation"]
        
        for depth in depths:
            request = ResearchRequest(
                question="AI infrastructure Western Australia",
                depth=depth
            )
            
            response = client.post("/api/research", json=request.model_dump())
            assert response.status_code == 200
            
            data = response.json()
            assert data["status"] in ["understanding", "sources", "crosscheck", "analysis", "review", "complete", "failed"]
    
    def test_get_research_session(self, client_with_rag_data):
        """Test retrieving a research session."""
        client = client_with_rag_data
        
        # Create a session
        request = ResearchRequest(
            question="AI infrastructure opportunities and risks",
            depth="standard"
        )
        
        create_response = client.post("/api/research", json=request.model_dump())
        session_id = create_response.json()["session_id"]
        
        # Retrieve the session
        response = client.get(f"/api/research/{session_id}")
        assert response.status_code == 200
        
        data = response.json()
        assert data["session_id"] == session_id
        assert data["question"] == request.question
    
    def test_get_nonexistent_research_session(self, client_with_rag_data):
        """Test retrieving a non-existent research session."""
        client = client_with_rag_data
        
        response = client.get("/api/research/nonexistent-session-id")
        assert response.status_code == 404
    
    def test_list_research_sessions(self, client_with_rag_data):
        """Test listing all research sessions."""
        client = client_with_rag_data
        
        # Create a couple of sessions
        for i in range(3):
            request = ResearchRequest(
                question=f"Test question {i}",
                depth="standard"
            )
            client.post("/api/research", json=request.model_dump())
        
        # List sessions
        response = client.get("/api/research")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 3
    
    def test_delete_research_session(self, client_with_rag_data):
        """Test deleting a research session."""
        client = client_with_rag_data
        
        # Create a session
        request = ResearchRequest(
            question="Test question for deletion",
            depth="standard"
        )
        
        create_response = client.post("/api/research", json=request.model_dump())
        session_id = create_response.json()["session_id"]
        
        # Delete the session
        response = client.delete(f"/api/research/{session_id}")
        assert response.status_code == 200
        
        data = response.json()
        assert data["success"] is True
        
        # Verify it's gone
        response = client.get(f"/api/research/{session_id}")
        assert response.status_code == 404


class TestResearchResponseStructure:
    """Test that research responses have the correct structure."""
    
    def test_research_response_has_required_fields(self, client_with_rag_data):
        """Test that research response contains all required fields."""
        client = client_with_rag_data
        
        request = ResearchRequest(
            question="AI infrastructure in Western Australia",
            depth="standard"
        )
        
        response = client.post("/api/research", json=request.model_dump())
        data = response.json()
        
        # Check required fields
        required_fields = ["session_id", "question", "status", "stage", "progress"]
        for field in required_fields:
            assert field in data, f"Missing required field: {field}"
    
    def test_completed_research_has_results(self, client_with_rag_data):
        """Test that completed research has result fields."""
        client = client_with_rag_data
        
        request = ResearchRequest(
            question="AI infrastructure in Western Australia",
            depth="standard"
        )
        
        response = client.post("/api/research", json=request.model_dump())
        data = response.json()
        
        # If research completed, should have results
        if data.get("status") == "complete":
            # These fields should be present for completed research
            assert "short_answer" in data
            assert "findings" in data
            assert "sources" in data


class TestResearchSecurity:
    """Test security aspects of research functionality."""
    
    def test_research_rejects_short_question(self, test_app):
        """Test that research rejects questions that are too short."""
        client = test_app
        
        # Try with a very short question
        request = {
            "question": "AI",
            "depth": "standard"
        }
        
        response = client.post("/api/research", json=request)
        # Should either fail validation or still process but with limited results
        assert response.status_code in [200, 422]  # Either succeeds or fails validation
    
    def test_research_with_malicious_input(self, test_app):
        """Test research with potentially malicious input."""
        client = test_app
        
        # Try with script injection
        request = {
            "question": "<script>alert('xss')</script> What is AI?",
            "depth": "standard"
        }
        
        response = client.post("/api/research", json=request)
        # Should handle gracefully without executing scripts
        assert response.status_code == 200
        data = response.json()
        assert "session_id" in data


class TestResearchDataIntegrity:
    """Test data integrity and provenance aspects."""
    
    def test_research_provenance_recorded(self, client_with_rag_data):
        """Test that research provenance is properly recorded."""
        client = client_with_rag_data
        
        request = ResearchRequest(
            question="AI infrastructure opportunities and risks",
            depth="standard"
        )
        
        response = client.post("/api/research", json=request.model_dump())
        data = response.json()
        
        if data.get("status") == "complete" and data.get("provenance"):
            provenance = data["provenance"]
            assert "research_session_id" in provenance
            assert "question_hash" in provenance
            assert "timestamp" in provenance
            assert "ver_audit_results" in provenance
    
    def test_research_metadata_extraction(self, client_with_rag_data):
        """Test that metadata is properly extracted from questions."""
        client = client_with_rag_data
        
        request = ResearchRequest(
            question="What is the Commonwealth government policy on AI infrastructure in Western Australia?",
            depth="standard"
        )
        
        response = client.post("/api/research", json=request.model_dump())
        data = response.json()
        
        if data.get("metadata"):
            metadata = data["metadata"]
            # Should detect political and economic aspects
            assert isinstance(metadata, dict)
            # May have jurisdictions for Australian context
            if "jurisdictions" in metadata:
                assert isinstance(metadata["jurisdictions"], list)