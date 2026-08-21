const SERVICE_NAME: &str = "com.whkerwin.forgeui";

fn validate_ref(secret_ref: &str) -> Result<(), String> {
    if secret_ref.is_empty()
        || secret_ref.len() > 200
        || !secret_ref
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err("密钥引用格式无效".into());
    }
    Ok(())
}

pub fn save(secret_ref: String, value: String) -> Result<(), String> {
    validate_ref(&secret_ref)?;
    keyring::Entry::new(SERVICE_NAME, &secret_ref)
        .map_err(|e| e.to_string())?
        .set_password(&value)
        .map_err(|e| e.to_string())
}

pub fn delete(secret_ref: String) -> Result<(), String> {
    validate_ref(&secret_ref)?;
    keyring::Entry::new(SERVICE_NAME, &secret_ref)
        .map_err(|e| e.to_string())?
        .delete_credential()
        .map_err(|e| e.to_string())
}

pub fn load(secret_ref: &str) -> Result<String, String> {
    validate_ref(secret_ref)?;
    keyring::Entry::new(SERVICE_NAME, secret_ref)
        .map_err(|e| e.to_string())?
        .get_password()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::validate_ref;

    #[test]
    fn secret_refs_are_local_safe_identifiers() {
        assert!(validate_ref("model-default-header-XProvider").is_ok());
        assert!(validate_ref("../../other-service").is_err());
        assert!(validate_ref("Authorization\nInjected").is_err());
    }
}
