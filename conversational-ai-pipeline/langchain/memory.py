"""
Memory management for the conversational agent.
Handles both short-term conversation memory and long-term semantic memory.
"""

from typing import List, Optional, Dict, Any
from langchain.memory import ConversationBufferMemory, ConversationSummaryMemory
from langchain.memory.chat_memory import BaseChatMemory
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS, Chroma
from langchain_text_splitters import RecursiveCharacterTextSplitter
import os
import json
from datetime import datetime


class ConversationMemory:
    """
    Manages conversation context and short-term memory.
    """
    
    def __init__(
        self,
        memory_type: str = "buffer",  # "buffer" or "summary"
        max_token_limit: int = 2000,
        return_messages: bool = True
    ):
        """
        Initialize conversation memory.
        
        Args:
            memory_type: Type of memory ("buffer" or "summary")
            max_token_limit: Maximum tokens for summary memory
            return_messages: Whether to return messages or strings
        """
        self.memory_type = memory_type
        self.max_token_limit = max_token_limit
        
        if memory_type == "summary":
            self.memory = ConversationSummaryMemory(
                return_messages=return_messages,
                max_token_limit=max_token_limit
            )
        else:
            self.memory = ConversationBufferMemory(
                return_messages=return_messages
            )
    
    def save_context(self, inputs: Dict[str, Any], outputs: Dict[str, Any]) -> None:
        """Save a conversation turn to memory."""
        self.memory.save_context(inputs, outputs)
    
    def load_memory_variables(self, inputs: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Load memory variables."""
        return self.memory.load_memory_variables(inputs or {})
    
    def clear(self) -> None:
        """Clear conversation memory."""
        self.memory.clear()
    
    def get_messages(self) -> List[BaseMessage]:
        """Get all messages from memory."""
        if hasattr(self.memory, 'chat_memory'):
            return self.memory.chat_memory.messages
        return []


class LongTermMemory:
    """
    Manages long-term semantic memory using vector stores.
    Stores important facts, user preferences, and context for retrieval.
    """
    
    def __init__(
        self,
        vector_store_type: str = "faiss",  # "faiss" or "chroma"
        persist_directory: Optional[str] = None,
        embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    ):
        """
        Initialize long-term memory.
        
        Args:
            vector_store_type: Type of vector store ("faiss" or "chroma")
            persist_directory: Directory to persist vector store
            embedding_model: HuggingFace embedding model name
        """
        self.vector_store_type = vector_store_type
        self.persist_directory = persist_directory or "./memory_store"
        self.embedding_model = embedding_model
        
        # Initialize embeddings
        self.embeddings = HuggingFaceEmbeddings(
            model_name=embedding_model,
            model_kwargs={'device': 'cpu'}
        )
        
        # Initialize text splitter
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200
        )
        
        # Initialize vector store
        self.vector_store = self._initialize_vector_store()
    
    def _initialize_vector_store(self):
        """Initialize or load vector store."""
        if self.vector_store_type == "faiss":
            index_path = os.path.join(self.persist_directory, "faiss_index")
            if os.path.exists(index_path):
                return FAISS.load_local(
                    index_path,
                    self.embeddings,
                    allow_dangerous_deserialization=True
                )
            else:
                # Create empty FAISS index
                os.makedirs(self.persist_directory, exist_ok=True)
                # Create a dummy document to initialize
                from langchain_core.documents import Document
                dummy_doc = Document(page_content="Initial memory")
                return FAISS.from_documents([dummy_doc], self.embeddings)
        
        elif self.vector_store_type == "chroma":
            return Chroma(
                persist_directory=self.persist_directory,
                embedding_function=self.embeddings
            )
        else:
            raise ValueError(f"Unknown vector store type: {self.vector_store_type}")
    
    def add_memory(
        self,
        content: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> None:
        """
        Add a memory to long-term storage.
        
        Args:
            content: Content to store
            metadata: Optional metadata (e.g., timestamp, user_id, type)
        """
        from langchain_core.documents import Document
        
        # Add timestamp if not provided
        if metadata is None:
            metadata = {}
        
        if "timestamp" not in metadata:
            metadata["timestamp"] = datetime.now().isoformat()
        
        # Split text into chunks
        texts = self.text_splitter.split_text(content)
        documents = [
            Document(page_content=text, metadata=metadata)
            for text in texts
        ]
        
        # Add to vector store
        if self.vector_store_type == "faiss":
            self.vector_store.add_documents(documents)
        else:
            self.vector_store.add_documents(documents)
    
    def search_memory(
        self,
        query: str,
        k: int = 5,
        filter_dict: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Search long-term memory for relevant information.
        
        Args:
            query: Search query
            k: Number of results to return
            filter_dict: Optional metadata filters
        
        Returns:
            List of relevant memories with scores
        """
        if self.vector_store_type == "faiss":
            if filter_dict:
                # FAISS doesn't support filtering directly, so we'll search and filter
                docs_with_scores = self.vector_store.similarity_search_with_score(
                    query, k=k*2
                )
                # Filter by metadata
                filtered_results = []
                for doc, score in docs_with_scores:
                    if all(doc.metadata.get(k) == v for k, v in filter_dict.items()):
                        filtered_results.append({
                            "content": doc.page_content,
                            "metadata": doc.metadata,
                            "score": float(score)
                        })
                        if len(filtered_results) >= k:
                            break
                return filtered_results
            else:
                docs_with_scores = self.vector_store.similarity_search_with_score(
                    query, k=k
                )
                return [
                    {
                        "content": doc.page_content,
                        "metadata": doc.metadata,
                        "score": float(score)
                    }
                    for doc, score in docs_with_scores
                ]
        else:
            # ChromaDB supports filtering
            if filter_dict:
                results = self.vector_store.similarity_search_with_score(
                    query, k=k, filter=filter_dict
                )
            else:
                results = self.vector_store.similarity_search_with_score(query, k=k)
            
            return [
                {
                    "content": doc.page_content,
                    "metadata": doc.metadata,
                    "score": float(score)
                }
                for doc, score in results
            ]
    
    def save(self) -> None:
        """Persist vector store to disk."""
        if self.vector_store_type == "faiss":
            index_path = os.path.join(self.persist_directory, "faiss_index")
            os.makedirs(self.persist_directory, exist_ok=True)
            self.vector_store.save_local(index_path)
        elif self.vector_store_type == "chroma":
            self.vector_store.persist()
    
    def clear(self) -> None:
        """Clear all long-term memories (creates new empty store)."""
        if self.vector_store_type == "faiss":
            index_path = os.path.join(self.persist_directory, "faiss_index")
            if os.path.exists(index_path):
                import shutil
                shutil.rmtree(index_path)
            self.vector_store = self._initialize_vector_store()
        else:
            # For ChromaDB, delete and recreate
            import shutil
            if os.path.exists(self.persist_directory):
                shutil.rmtree(self.persist_directory)
            self.vector_store = self._initialize_vector_store()


class MemoryManager:
    """
    Unified memory manager combining conversation and long-term memory.
    """
    
    def __init__(
        self,
        conversation_memory_type: str = "buffer",
        vector_store_type: str = "faiss",
        persist_directory: Optional[str] = None
    ):
        """
        Initialize memory manager.
        
        Args:
            conversation_memory_type: Type of conversation memory
            vector_store_type: Type of vector store for long-term memory
            persist_directory: Directory to persist long-term memory
        """
        self.conversation_memory = ConversationMemory(
            memory_type=conversation_memory_type
        )
        self.long_term_memory = LongTermMemory(
            vector_store_type=vector_store_type,
            persist_directory=persist_directory
        )
    
    def get_conversation_context(self) -> List[BaseMessage]:
        """Get current conversation context."""
        return self.conversation_memory.get_messages()
    
    def retrieve_relevant_memories(self, query: str, k: int = 5) -> List[Dict[str, Any]]:
        """Retrieve relevant long-term memories for a query."""
        return self.long_term_memory.search_memory(query, k=k)
    
    def save_conversation_turn(
        self,
        user_input: str,
        ai_response: str,
        save_to_long_term: bool = False
    ) -> None:
        """
        Save a conversation turn.
        
        Args:
            user_input: User's input message
            ai_response: AI's response
            save_to_long_term: Whether to also save to long-term memory
        """
        self.conversation_memory.save_context(
            {"input": user_input},
            {"output": ai_response}
        )
        
        if save_to_long_term:
            # Save important conversation to long-term memory
            conversation_text = f"User: {user_input}\nAssistant: {ai_response}"
            self.long_term_memory.add_memory(
                conversation_text,
                metadata={"type": "conversation", "timestamp": datetime.now().isoformat()}
            )
    
    def persist(self) -> None:
        """Persist all memories to disk."""
        self.long_term_memory.save()
    
    def clear_all(self) -> None:
        """Clear all memories."""
        self.conversation_memory.clear()
        self.long_term_memory.clear()

