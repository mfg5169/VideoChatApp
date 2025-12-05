/// Runtime inference engine for executing models.
use crate::architectures::{ArchitectureRegistry, Model};
use crate::config::{ModelConfig, PreprocessingConfig};
use crate::loader::ModelLoader;
use candle_nn::VarBuilder;
use candle_core::{Device, Tensor};
use anyhow::{Context, Result};
use std::path::PathBuf;

/// Runtime for model inference
pub struct ModelRuntime {
    /// The loaded model
    model: Box<dyn Model>,
    /// Model configuration
    config: ModelConfig,
    /// Device used for inference
    device: Device,
}

impl ModelRuntime {
    /// Create a new runtime from a model configuration file
    pub fn from_config<P: Into<PathBuf>>(
        model_dir: P,
        config_path: &str,
        device: Option<Device>,
    ) -> Result<Self> {
        let model_dir = model_dir.into();
        let device = device.unwrap_or_else(|| Device::Cpu);

        // Load configuration
        let mut loader = ModelLoader::with_device(&model_dir, device.clone());
        let config = loader.load_config(config_path)?;

        // Load weights
        let weights = loader.load_weights(&config.weights)?;

        // Create variable builder (need to ensure weights live long enough)
        // For now, we'll create it inline
        let vb = VarBuilder::from_tensors(&weights, candle_core::DType::F32, &device);

        // Build model architecture
        let registry = ArchitectureRegistry::default();
        let model = registry.build(&config, vb, &device)?;

        Ok(Self {
            model,
            config,
            device,
        })
    }

    /// Run inference on input tensor
    pub fn infer(&self, input: &Tensor) -> Result<Tensor> {
        // Ensure input is on the correct device
        let input = input.to_device(self.model.device())?;
        
        // Run forward pass
        self.model.forward(&input)
    }

    /// Run inference with preprocessing
    pub fn infer_with_preprocessing(&self, raw_input: &[f32], shape: &[usize]) -> Result<Tensor> {
        // Create input tensor
        let input = Tensor::from_slice(raw_input, shape, self.model.device())?;

        // Apply preprocessing if configured
        let processed = if let Some(ref preprocess) = self.config.preprocessing {
            self.apply_preprocessing(&input, preprocess)?
        } else {
            input
        };

        // Run inference
        self.infer(&processed)
    }

    /// Apply preprocessing to input
    fn apply_preprocessing(&self, input: &Tensor, config: &PreprocessingConfig) -> Result<Tensor> {
        let mut processed = input.clone();

        // Apply normalization if configured
        if let Some(ref norm) = config.normalization {
            processed = self.normalize(&processed, &norm.mean, &norm.std)?;
        }

        // Apply resize if configured (for images)
        if let Some(ref resize) = config.resize {
            // Resize would be implemented here
            // For now, we'll skip it as it requires image processing
        }

        Ok(processed)
    }

    /// Normalize tensor with mean and std
    fn normalize(&self, input: &Tensor, mean: &[f32], std: &[f32]) -> Result<Tensor> {
        // Create mean and std tensors
        let mean_tensor = Tensor::new(mean, input.device())?;
        let std_tensor = Tensor::new(std, input.device())?;

        // Normalize: (x - mean) / std
        let normalized = (input - &mean_tensor)?;
        normalized.broadcast_div(&std_tensor)
    }

    /// Get model configuration
    pub fn config(&self) -> &ModelConfig {
        &self.config
    }

    /// Get device
    pub fn device(&self) -> &Device {
        &self.device
    }

    /// Batch inference
    pub fn infer_batch(&self, inputs: &[Tensor]) -> Result<Vec<Tensor>> {
        inputs.iter()
            .map(|input| self.infer(input))
            .collect()
    }
}

/// Async runtime for concurrent inference
pub struct AsyncModelRuntime {
    runtime: ModelRuntime,
}

impl AsyncModelRuntime {
    /// Create a new async runtime
    pub fn new(runtime: ModelRuntime) -> Self {
        Self { runtime }
    }

    /// Run inference asynchronously
    pub async fn infer_async(&self, input: &Tensor) -> Result<Tensor> {
        // For now, just run synchronously
        // In a real implementation, you'd use tokio::task::spawn_blocking
        tokio::task::spawn_blocking({
            let input = input.clone();
            let runtime = &self.runtime;
            move || runtime.infer(&input)
        })
        .await
        .map_err(|e| anyhow::anyhow!("Task join error: {}", e))?
    }
}

