/// Model configuration structures for loading and reconstructing models.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Model architecture types supported by the framework
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArchitectureType {
    /// Transformer-based models (BERT, GPT, etc.)
    Transformer,
    /// Vision Transformer (ViT)
    VisionTransformer,
    /// Convolutional Neural Network
    Cnn,
    /// Recurrent Neural Network (LSTM, GRU)
    Rnn,
    /// Encoder-Decoder architecture
    EncoderDecoder,
    /// Multi-modal models (vision + language)
    Multimodal,
    /// Custom architecture
    Custom(String),
}

/// Layer configuration for neural network layers
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayerConfig {
    /// Layer type (linear, conv2d, attention, etc.)
    pub layer_type: String,
    /// Layer name/identifier
    pub name: String,
    /// Input dimensions
    pub input_dims: Vec<usize>,
    /// Output dimensions
    pub output_dims: Vec<usize>,
    /// Additional layer-specific parameters
    #[serde(default)]
    pub params: HashMap<String, serde_json::Value>,
}

/// Weight file configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeightConfig {
    /// Path to weight file (relative to model directory)
    pub path: String,
    /// Format of the weight file (safetensors, pytorch, onnx, etc.)
    pub format: String,
    /// Optional checksum for verification
    #[serde(default)]
    pub checksum: Option<String>,
    /// Compression type if applicable
    #[serde(default)]
    pub compression: Option<String>,
}

/// Model metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelMetadata {
    /// Model name
    pub name: String,
    /// Model version
    pub version: String,
    /// Model description
    #[serde(default)]
    pub description: Option<String>,
    /// Author/organization
    #[serde(default)]
    pub author: Option<String>,
    /// License
    #[serde(default)]
    pub license: Option<String>,
    /// Task type (classification, generation, etc.)
    #[serde(default)]
    pub task: Option<String>,
}

/// Hyperparameters for the model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hyperparameters {
    /// Vocabulary size
    #[serde(default)]
    pub vocab_size: Option<usize>,
    /// Hidden size/dimension
    #[serde(default)]
    pub hidden_size: Option<usize>,
    /// Number of attention heads
    #[serde(default)]
    pub num_attention_heads: Option<usize>,
    /// Number of layers
    #[serde(default)]
    pub num_layers: Option<usize>,
    /// Intermediate size (for feed-forward networks)
    #[serde(default)]
    pub intermediate_size: Option<usize>,
    /// Maximum sequence length
    #[serde(default)]
    pub max_position_embeddings: Option<usize>,
    /// Image size for vision models
    #[serde(default)]
    pub image_size: Option<usize>,
    /// Number of channels
    #[serde(default)]
    pub num_channels: Option<usize>,
    /// Additional custom hyperparameters
    #[serde(default)]
    pub custom: HashMap<String, serde_json::Value>,
}

/// Complete model configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    /// Model metadata
    pub metadata: ModelMetadata,
    /// Architecture type
    pub architecture: ArchitectureType,
    /// Model hyperparameters
    pub hyperparameters: Hyperparameters,
    /// Layer configurations
    pub layers: Vec<LayerConfig>,
    /// Weight file configurations
    pub weights: Vec<WeightConfig>,
    /// Tokenizer configuration (if applicable)
    #[serde(default)]
    pub tokenizer: Option<TokenizerConfig>,
    /// Preprocessing configuration
    #[serde(default)]
    pub preprocessing: Option<PreprocessingConfig>,
    /// Postprocessing configuration
    #[serde(default)]
    pub postprocessing: Option<PostprocessingConfig>,
}

/// Tokenizer configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenizerConfig {
    /// Tokenizer type (bpe, wordpiece, sentencepiece, etc.)
    pub tokenizer_type: String,
    /// Path to tokenizer files
    pub vocab_file: Option<String>,
    pub merges_file: Option<String>,
    /// Special tokens
    #[serde(default)]
    pub special_tokens: HashMap<String, usize>,
}

/// Preprocessing configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreprocessingConfig {
    /// Normalization parameters
    #[serde(default)]
    pub normalization: Option<NormalizationConfig>,
    /// Resize parameters for images
    #[serde(default)]
    pub resize: Option<ResizeConfig>,
    /// Data augmentation (if applicable)
    #[serde(default)]
    pub augmentation: Option<AugmentationConfig>,
}

/// Normalization configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NormalizationConfig {
    /// Mean values for normalization
    pub mean: Vec<f32>,
    /// Standard deviation values
    pub std: Vec<f32>,
}

/// Resize configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResizeConfig {
    /// Target width
    pub width: usize,
    /// Target height
    pub height: usize,
    /// Interpolation method
    #[serde(default)]
    pub interpolation: String,
}

/// Augmentation configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AugmentationConfig {
    /// Random crop
    #[serde(default)]
    pub random_crop: Option<bool>,
    /// Random flip
    #[serde(default)]
    pub random_flip: Option<bool>,
}

/// Postprocessing configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostprocessingConfig {
    /// Output format
    #[serde(default)]
    pub output_format: Option<String>,
    /// Confidence threshold
    #[serde(default)]
    pub confidence_threshold: Option<f32>,
}

impl ModelConfig {
    /// Load model configuration from a YAML file
    pub fn from_yaml(path: &str) -> anyhow::Result<Self> {
        let content = std::fs::read_to_string(path)?;
        let config: ModelConfig = serde_yaml::from_str(&content)?;
        Ok(config)
    }

    /// Load model configuration from a JSON file
    pub fn from_json(path: &str) -> anyhow::Result<Self> {
        let content = std::fs::read_to_string(path)?;
        let config: ModelConfig = serde_json::from_str(&content)?;
        Ok(config)
    }

    /// Save model configuration to a YAML file
    pub fn to_yaml(&self, path: &str) -> anyhow::Result<()> {
        let content = serde_yaml::to_string(self)?;
        std::fs::write(path, content)?;
        Ok(())
    }

    /// Save model configuration to a JSON file
    pub fn to_json(&self, path: &str) -> anyhow::Result<()> {
        let content = serde_json::to_string_pretty(self)?;
        std::fs::write(path, content)?;
        Ok(())
    }

    /// Validate the configuration
    pub fn validate(&self) -> anyhow::Result<()> {
        // Validate that layers match architecture
        if self.layers.is_empty() {
            anyhow::bail!("Model must have at least one layer");
        }

        // Validate weights
        if self.weights.is_empty() {
            anyhow::bail!("Model must have at least one weight file");
        }

        // Validate hyperparameters based on architecture
        match &self.architecture {
            ArchitectureType::Transformer | ArchitectureType::EncoderDecoder => {
                if self.hyperparameters.hidden_size.is_none() {
                    anyhow::bail!("Transformer models require hidden_size");
                }
                if self.hyperparameters.num_attention_heads.is_none() {
                    anyhow::bail!("Transformer models require num_attention_heads");
                }
            }
            ArchitectureType::VisionTransformer => {
                if self.hyperparameters.image_size.is_none() {
                    anyhow::bail!("Vision Transformer requires image_size");
                }
            }
            ArchitectureType::Cnn => {
                if self.hyperparameters.num_channels.is_none() {
                    anyhow::bail!("CNN models require num_channels");
                }
            }
            _ => {}
        }

        Ok(())
    }
}

