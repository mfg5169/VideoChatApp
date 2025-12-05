/// Model loader for loading weights and reconstructing models from configuration.
use crate::config::{ModelConfig, WeightConfig};
use candle_core::{Device, Tensor};
use candle_nn::VarBuilder;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use anyhow::{Context, Result};

/// Model loader that handles loading weights and reconstructing models
pub struct ModelLoader {
    /// Base directory where model files are stored
    base_path: PathBuf,
    /// Device to load model on (CPU, CUDA, etc.)
    device: Device,
}

impl ModelLoader {
    /// Create a new model loader
    pub fn new<P: AsRef<Path>>(base_path: P) -> Self {
        Self {
            base_path: base_path.as_ref().to_path_buf(),
            device: Device::Cpu, // Default to CPU, can be changed
        }
    }

    /// Create a model loader with a specific device
    pub fn with_device<P: AsRef<Path>>(base_path: P, device: Device) -> Self {
        Self {
            base_path: base_path.as_ref().to_path_buf(),
            device,
        }
    }

    /// Load model configuration from a file
    pub fn load_config(&self, config_path: &str) -> Result<ModelConfig> {
        let config_file = self.base_path.join(config_path);
        
        let config = if config_file.extension().and_then(|s| s.to_str()) == Some("yaml") 
            || config_file.extension().and_then(|s| s.to_str()) == Some("yml") {
            ModelConfig::from_yaml(config_file.to_str().unwrap())?
        } else {
            ModelConfig::from_json(config_file.to_str().unwrap())?
        };

        config.validate()?;
        Ok(config)
    }

    /// Load weights from weight files
    pub fn load_weights(&self, weight_configs: &[WeightConfig]) -> Result<HashMap<String, Tensor>> {
        let mut weights = HashMap::new();

        for weight_config in weight_configs {
            let weight_path = self.base_path.join(&weight_config.path);
            
            if !weight_path.exists() {
                anyhow::bail!("Weight file not found: {}", weight_path.display());
            }

            match weight_config.format.as_str() {
                "safetensors" => {
                    let loaded = self.load_safetensors(&weight_path)?;
                    weights.extend(loaded);
                }
                "pytorch" | "pt" => {
                    let loaded = self.load_pytorch(&weight_path)?;
                    weights.extend(loaded);
                }
                "onnx" => {
                    let loaded = self.load_onnx(&weight_path)?;
                    weights.extend(loaded);
                }
                "numpy" | "npz" => {
                    let loaded = self.load_numpy(&weight_path)?;
                    weights.extend(loaded);
                }
                _ => {
                    anyhow::bail!("Unsupported weight format: {}", weight_config.format);
                }
            }
        }

        Ok(weights)
    }

    /// Load weights from SafeTensors format
    fn load_safetensors(&self, path: &Path) -> Result<HashMap<String, Tensor>> {
        use safetensors::SafeTensors;
        
        let data = std::fs::read(path)
            .with_context(|| format!("Failed to read safetensors file: {}", path.display()))?;
        
        let tensors = SafeTensors::deserialize(&data)?;
        let mut weights = HashMap::new();

        for (name, view) in tensors.names() {
            let tensor = self.view_to_tensor(view)?;
            weights.insert(name.to_string(), tensor);
        }

        Ok(weights)
    }

    /// Load weights from PyTorch format
    fn load_pytorch(&self, path: &Path) -> Result<HashMap<String, Tensor>> {
        // Note: PyTorch loading requires additional dependencies
        // This is a placeholder - in practice, you'd use candle's pytorch loader
        // or convert PyTorch models to safetensors first
        anyhow::bail!("PyTorch loading not yet implemented. Please convert to safetensors format.");
    }

    /// Load weights from ONNX format
    fn load_onnx(&self, path: &Path) -> Result<HashMap<String, Tensor>> {
        // ONNX loading would require ort or similar
        anyhow::bail!("ONNX loading not yet implemented. Please convert to safetensors format.");
    }

    /// Load weights from NumPy format
    fn load_numpy(&self, path: &Path) -> Result<HashMap<String, Tensor>> {
        // NumPy loading would require additional dependencies
        // For now, recommend using safetensors format
        anyhow::bail!("NumPy loading not yet implemented. Please convert to safetensors format.");
    }

    /// Convert a SafeTensors view to a Candle Tensor
    fn view_to_tensor(&self, view: safetensors::tensor::TensorView) -> Result<Tensor> {
        let shape: Vec<usize> = view.shape().iter().map(|&d| d as usize).collect();
        
        match view.dtype() {
            safetensors::Dtype::F32 => {
                // SafeTensors already provides the data as a slice
                let data = view.data();
                // Convert byte slice to f32 slice
                let f32_data: &[f32] = unsafe {
                    std::slice::from_raw_parts(
                        data.as_ptr() as *const f32,
                        data.len() / 4
                    )
                };
                Tensor::from_slice(f32_data, shape.as_slice(), &self.device)
            }
            safetensors::Dtype::F16 => {
                // Convert F16 to F32
                let data = view.data();
                let f32_data: Vec<f32> = data.chunks_exact(2)
                    .map(|chunk| {
                        let half = u16::from_le_bytes([chunk[0], chunk[1]]);
                        // Convert f16 to f32 (simplified - would need proper f16 library)
                        half as f32 / 65536.0
                    })
                    .collect();
                Tensor::from_slice(&f32_data, shape.as_slice(), &self.device)
            }
            safetensors::Dtype::I64 => {
                let data = view.data();
                let i64_data: &[i64] = unsafe {
                    std::slice::from_raw_parts(
                        data.as_ptr() as *const i64,
                        data.len() / 8
                    )
                };
                Tensor::from_slice(i64_data, shape.as_slice(), &self.device)
            }
            _ => {
                anyhow::bail!("Unsupported dtype: {:?}", view.dtype());
            }
        }
    }

    /// Get the device being used
    pub fn device(&self) -> &Device {
        &self.device
    }

    /// Set the device
    pub fn set_device(&mut self, device: Device) {
        self.device = device;
    }

    /// Get the base path
    pub fn base_path(&self) -> &Path {
        &self.base_path
    }
}

// Helper function to create VarBuilder from weights
pub fn create_var_builder<'a>(
    weights: &'a HashMap<String, Tensor>,
    device: &Device,
) -> Result<VarBuilder<'a>> {
    // Create a VarBuilder from the loaded weights
    // This allows the architecture builders to access weights by name
    VarBuilder::from_tensors(weights, candle_core::DType::F32, device)
}

