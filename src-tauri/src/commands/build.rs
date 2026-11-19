//! 编译产物相关：把内置的启动器写到用户选的输出目录。
//!
//! 启动器是 `FangUI/rust/float-launcher` 编出来的原生 exe（本地服务 + WebView2），
//! 构建主程序时用 include_bytes! 内嵌。这样产物里不需要 C#，也不用现编 Rust。

/// 内嵌的启动器二进制。构建前先跑：
///   cargo build --release --manifest-path ../../FangUI/rust/float-launcher/Cargo.toml
///   copy ../../FangUI/rust/float-launcher/target/release/float-launcher.exe src-tauri/resources/
const LAUNCHER: &[u8] = include_bytes!("../../resources/float-launcher.exe");

#[tauri::command]
pub fn write_launcher(path: String) -> Result<u64, String> {
    if LAUNCHER.is_empty() {
        return Err("启动器资源是空的".into());
    }
    if let Some(dir) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("建目录失败：{e}"))?;
    }
    std::fs::write(&path, LAUNCHER).map_err(|e| format!("写启动器失败 {path}: {e}"))?;
    Ok(LAUNCHER.len() as u64)
}
