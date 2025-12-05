"""
Model integration for calling external models (ONNX, Rust, C++).
Handles different model backends and data types (video, image, text).
"""

import os
import subprocess
import json
import base64
import tempfile
from typing import Optional, List, Dict, Any, Union
from pathlib import Path
import numpy as np
from PIL import Image
import cv2


class ModelBackend:
    """Base class for model backends."""
    
    def __init__(self, model_path: str, config: Optional[Dict[str, Any]] = None):
        """
        Initialize model backend.
        
        Args:
            model_path: Path to the model file or directory
            config: Optional configuration dictionary
        """
        self.model_path = model_path
        self.config = config or {}
    
    def infer(self, data: Any, **kwargs) -> Any:
        """
        Run inference on the provided data.
        
        Args:
            data: Input data (can be text, image, video, etc.)
            **kwargs: Additional inference parameters
        
        Returns:
            Model output
        """
        raise NotImplementedError("Subclasses must implement infer method")
    
    def supports_data_type(self, data_type: str) -> bool:
        """Check if this backend supports a specific data type."""
        raise NotImplementedError("Subclasses must implement supports_data_type method")


class ONNXModelBackend(ModelBackend):
    """ONNX model backend using onnxruntime."""
    
    def __init__(self, model_path: str, config: Optional[Dict[str, Any]] = None):
        super().__init__(model_path, config)
        try:
            import onnxruntime as ort
            self.ort = ort
        except ImportError:
            raise ImportError("onnxruntime is required for ONNX models. Install with: pip install onnxruntime")
        
        # Create inference session
        providers = self.config.get("providers", ["CPUExecutionProvider"])
        self.session = ort.InferenceSession(
            model_path,
            providers=providers
        )
        
        # Get input/output names
        self.input_names = [input.name for input in self.session.get_inputs()]
        self.output_names = [output.name for output in self.session.get_outputs()]
    
    def infer(self, data: Any, **kwargs) -> Dict[str, np.ndarray]:
        """
        Run ONNX inference.
        
        Args:
            data: Input data (numpy array, image, text, etc.)
            **kwargs: Additional parameters
        
        Returns:
            Dictionary of output tensors
        """
        # Convert input to numpy array if needed
        if isinstance(data, (Image.Image, np.ndarray)):
            input_array = self._prepare_image_input(data)
        elif isinstance(data, str):
            input_array = self._prepare_text_input(data)
        elif isinstance(data, np.ndarray):
            input_array = data
        else:
            raise ValueError(f"Unsupported input type: {type(data)}")
        
        # Prepare inputs
        inputs = {}
        for i, input_name in enumerate(self.input_names):
            if i == 0:
                inputs[input_name] = input_array
            else:
                # Handle multiple inputs if needed
                inputs[input_name] = kwargs.get(f"input_{i}", input_array)
        
        # Run inference
        outputs = self.session.run(self.output_names, inputs)
        
        # Return as dictionary
        return {name: output for name, output in zip(self.output_names, outputs)}
    
    def _prepare_image_input(self, image: Union[Image.Image, np.ndarray]) -> np.ndarray:
        """Prepare image input for ONNX model."""
        if isinstance(image, Image.Image):
            image = np.array(image)
        
        # Normalize if needed
        if image.dtype != np.float32:
            image = image.astype(np.float32) / 255.0
        
        # Add batch dimension if needed
        if len(image.shape) == 3:
            image = np.expand_dims(image, axis=0)
        
        return image
    
    def _prepare_text_input(self, text: str) -> np.ndarray:
        """Prepare text input (simplified - would need tokenization in practice)."""
        # This is a placeholder - in practice you'd use a tokenizer
        # For now, return a dummy array
        return np.array([[len(text)]], dtype=np.float32)
    
    def supports_data_type(self, data_type: str) -> bool:
        """ONNX models can handle various data types."""
        return data_type in ["image", "text", "tensor", "video"]


class RustModelBackend(ModelBackend):
    """Rust model backend using the Rust model runtime."""
    
    def __init__(self, model_path: str, config: Optional[Dict[str, Any]] = None):
        super().__init__(model_path, config)
        self.config_path = self.config.get("config_path", "config.yaml")
        self.rust_binary = self.config.get("rust_binary", None)
        
        # Check if Rust binary exists
        if self.rust_binary and not os.path.exists(self.rust_binary):
            raise FileNotFoundError(f"Rust binary not found: {self.rust_binary}")
    
    def infer(self, data: Any, **kwargs) -> Dict[str, Any]:
        """
        Run Rust model inference via subprocess or FFI.
        
        Args:
            data: Input data
            **kwargs: Additional parameters
        
        Returns:
            Model output as dictionary
        """
        # Create temporary file for input data
        with tempfile.NamedTemporaryFile(delete=False, suffix=".json") as tmp_file:
            input_data = self._prepare_input(data)
            json.dump(input_data, tmp_file)
            tmp_path = tmp_file.name
        
        try:
            # Call Rust binary if available
            if self.rust_binary:
                result = subprocess.run(
                    [
                        self.rust_binary,
                        "--model", self.model_path,
                        "--config", os.path.join(self.model_path, self.config_path),
                        "--input", tmp_path,
                        "--output", "-"  # Output to stdout
                    ],
                    capture_output=True,
                    text=True,
                    check=True
                )
                output = json.loads(result.stdout)
            else:
                # Fallback: use Python FFI if Rust library is available
                # This would require building the Rust crate as a Python extension
                output = self._infer_via_ffi(data, tmp_path)
            
            return output
        finally:
            # Clean up temp file
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
    
    def _prepare_input(self, data: Any) -> Dict[str, Any]:
        """Prepare input data for Rust model."""
        if isinstance(data, np.ndarray):
            return {
                "type": "tensor",
                "shape": list(data.shape),
                "data": data.flatten().tolist(),
                "dtype": str(data.dtype)
            }
        elif isinstance(data, (Image.Image, np.ndarray)):
            # Convert image to base64
            if isinstance(data, Image.Image):
                data = np.array(data)
            
            # Save to temporary file and encode
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                Image.fromarray(data).save(tmp.name)
                with open(tmp.name, "rb") as f:
                    img_data = base64.b64encode(f.read()).decode()
                os.unlink(tmp.name)
            
            return {
                "type": "image",
                "format": "png",
                "data": img_data
            }
        elif isinstance(data, str):
            return {
                "type": "text",
                "data": data
            }
        else:
            raise ValueError(f"Unsupported input type: {type(data)}")
    
    def _infer_via_ffi(self, data: Any, input_path: str) -> Dict[str, Any]:
        """Infer using FFI (placeholder for future implementation)."""
        # This would require building the Rust crate as a Python extension
        # For now, return a placeholder
        return {"status": "FFI not yet implemented", "input_path": input_path}
    
    def supports_data_type(self, data_type: str) -> bool:
        """Rust models can handle various data types."""
        return data_type in ["image", "text", "tensor", "video"]


class CppModelBackend(ModelBackend):
    """C++ model backend via subprocess or shared library."""
    
    def __init__(self, model_path: str, config: Optional[Dict[str, Any]] = None):
        super().__init__(model_path, config)
        self.cpp_binary = self.config.get("cpp_binary", None)
        self.shared_lib = self.config.get("shared_lib", None)
        
        if not self.cpp_binary and not self.shared_lib:
            raise ValueError("Either cpp_binary or shared_lib must be provided")
    
    def infer(self, data: Any, **kwargs) -> Dict[str, Any]:
        """
        Run C++ model inference.
        
        Args:
            data: Input data
            **kwargs: Additional parameters
        
        Returns:
            Model output
        """
        if self.cpp_binary:
            return self._infer_via_subprocess(data, **kwargs)
        else:
            return self._infer_via_shared_lib(data, **kwargs)
    
    def _infer_via_subprocess(self, data: Any, **kwargs) -> Dict[str, Any]:
        """Run inference via C++ binary subprocess."""
        # Create temporary file for input
        with tempfile.NamedTemporaryFile(delete=False, suffix=".json") as tmp_file:
            input_data = self._prepare_input(data)
            json.dump(input_data, tmp_file)
            tmp_path = tmp_file.name
        
        try:
            # Call C++ binary
            cmd = [
                self.cpp_binary,
                "--model", self.model_path,
                "--input", tmp_path
            ]
            
            # Add additional arguments
            for key, value in kwargs.items():
                cmd.extend([f"--{key}", str(value)])
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=True
            )
            
            # Parse output
            try:
                output = json.loads(result.stdout)
            except json.JSONDecodeError:
                output = {"output": result.stdout, "raw": True}
            
            return output
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
    
    def _infer_via_shared_lib(self, data: Any, **kwargs) -> Dict[str, Any]:
        """Run inference via C++ shared library (using ctypes)."""
        try:
            import ctypes
        except ImportError:
            raise ImportError("ctypes is required for shared library support")
        
        # Load shared library
        lib = ctypes.CDLL(self.shared_lib)
        
        # Define function signature (would need to match C++ interface)
        # This is a placeholder - actual implementation depends on C++ API
        infer_func = lib.infer
        infer_func.argtypes = [ctypes.c_char_p, ctypes.c_char_p]
        infer_func.restype = ctypes.c_char_p
        
        # Prepare input
        input_data = json.dumps(self._prepare_input(data))
        input_ptr = ctypes.c_char_p(input_data.encode())
        
        # Call inference
        output_ptr = infer_func(input_ptr, ctypes.c_char_p(self.model_path.encode()))
        output = json.loads(output_ptr.decode())
        
        return output
    
    def _prepare_input(self, data: Any) -> Dict[str, Any]:
        """Prepare input data for C++ model."""
        if isinstance(data, np.ndarray):
            return {
                "type": "tensor",
                "shape": list(data.shape),
                "data": data.flatten().tolist(),
                "dtype": str(data.dtype)
            }
        elif isinstance(data, (Image.Image, np.ndarray)):
            # Save image to temporary file
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                if isinstance(data, Image.Image):
                    data.save(tmp.name)
                else:
                    Image.fromarray(data).save(tmp.name)
                return {
                    "type": "image",
                    "path": tmp.name
                }
        elif isinstance(data, str):
            return {
                "type": "text",
                "data": data
            }
        else:
            raise ValueError(f"Unsupported input type: {type(data)}")
    
    def supports_data_type(self, data_type: str) -> bool:
        """C++ models can handle various data types."""
        return data_type in ["image", "text", "tensor", "video"]


class ModelRegistry:
    """Registry for managing model backends."""
    
    def __init__(self):
        self.models: Dict[str, ModelBackend] = {}
    
    def register(self, name: str, backend: ModelBackend):
        """Register a model backend."""
        self.models[name] = backend
    
    def get(self, name: str) -> Optional[ModelBackend]:
        """Get a registered model backend."""
        return self.models.get(name)
    
    def list_models(self) -> List[str]:
        """List all registered model names."""
        return list(self.models.keys())
    
    def infer(self, model_name: str, data: Any, **kwargs) -> Any:
        """Run inference on a registered model."""
        backend = self.get(model_name)
        if not backend:
            raise ValueError(f"Model '{model_name}' not found")
        return backend.infer(data, **kwargs)


# Global model registry
default_registry = ModelRegistry()

