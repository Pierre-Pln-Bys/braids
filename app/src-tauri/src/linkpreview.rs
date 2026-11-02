// linkpreview.rs
//
// Copyright (c) 2026 braids contributors
//
// braids is distributed under the GNU AGPL v3 license, see LICENSE for details.

//! Link previews: the title, description, site name and image of a web page,
//! from its Open Graph / Twitter / HTML tags. The page is fetched from this
//! computer (like other desktop messengers do); addresses on this computer or
//! the local network are not fetched. Images are kept in the cache directory,
//! results in memory for the session.

use serde::Serialize;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::net::{IpAddr, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

const MAX_PAGE: u64 = 768 * 1024;
const MAX_IMAGE: u64 = 4 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Clone, Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub url: String,
    pub title: String,
    pub description: String,
    pub site_name: String,
    /// local file of the image, empty without one
    pub image: String,
}

static CACHE: Mutex<Option<HashMap<String, Option<Preview>>>> = Mutex::new(None);

/// The preview of `url` (None: no preview, e.g. not a page or not reachable).
pub fn preview(url: &str, cache_dir: &Path) -> Option<Preview> {
    if let Some(hit) = CACHE.lock().unwrap().get_or_insert_with(HashMap::new).get(url) {
        return hit.clone();
    }
    let result = fetch(url, cache_dir);
    CACHE.lock().unwrap().get_or_insert_with(HashMap::new).insert(url.to_string(), result.clone());
    result
}

/// http(s) URL whose host is not this computer or the local network.
fn public_url(raw: &str) -> Option<url::Url> {
    let parsed = url::Url::parse(raw).ok()?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return None;
    }
    let host = parsed.host_str()?;
    let port = parsed.port_or_known_default()?;
    let addrs: Vec<_> = (host, port).to_socket_addrs().ok()?.collect();
    if addrs.is_empty() || addrs.iter().any(|a| !is_public(a.ip())) {
        return None;
    }
    Some(parsed)
}

fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            !(v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified() || v4.is_broadcast()
                || v4.is_documentation() || v4.octets()[0] == 100 && (v4.octets()[1] & 0xc0) == 64)
        }
        IpAddr::V6(v6) => {
            let seg = v6.segments();
            !(v6.is_loopback() || v6.is_unspecified() || (seg[0] & 0xfe00) == 0xfc00 || (seg[0] & 0xffc0) == 0xfe80)
                && v6.to_ipv4_mapped().map_or(true, |v4| is_public(IpAddr::V4(v4)))
        }
    }
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(TIMEOUT)
        .redirects(0) // followed by hand, each hop checked
        .user_agent("Mozilla/5.0 (X11; Linux x86_64) braids link preview")
        .build()
}

/// GET with redirects (up to 5), each target checked with `public_url`.
fn get(raw: &str) -> Option<(url::Url, ureq::Response)> {
    let agent = agent();
    let mut target = public_url(raw)?;
    for _ in 0..5 {
        let response = match agent.get(target.as_str()).set("Accept-Language", "en").call() {
            Ok(r) => r,
            Err(ureq::Error::Status(_, r)) => r,
            Err(_) => return None,
        };
        if (300..400).contains(&response.status()) {
            let next = target.join(response.header("location")?).ok()?;
            target = public_url(next.as_str())?;
            continue;
        }
        if response.status() != 200 {
            return None;
        }
        return Some((target, response));
    }
    None
}

fn fetch(raw: &str, cache_dir: &Path) -> Option<Preview> {
    let (page_url, response) = get(raw)?;
    if !response.content_type().contains("html") {
        return None;
    }
    let mut body = Vec::new();
    response.into_reader().take(MAX_PAGE).read_to_end(&mut body).ok()?;
    let html = String::from_utf8_lossy(&body);
    let mut preview = parse(&html);
    if preview.title.is_empty() {
        return None;
    }
    preview.url = page_url.to_string();
    if preview.site_name.is_empty() {
        preview.site_name = page_url.host_str().unwrap_or_default().trim_start_matches("www.").to_string();
    }
    if !preview.image.is_empty() {
        preview.image = page_url
            .join(&preview.image)
            .ok()
            .and_then(|img| download_image(img.as_str(), cache_dir))
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
    }
    Some(preview)
}

fn download_image(raw: &str, cache_dir: &Path) -> Option<PathBuf> {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    raw.hash(&mut hasher);
    let name = format!("{:016x}", hasher.finish());
    let dir = cache_dir.join("previews");
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with(&name) {
                return Some(entry.path());
            }
        }
    }

    let (_, response) = get(raw)?;
    let ext = match response.content_type() {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => return None,
    };
    let mut data = Vec::new();
    response.into_reader().take(MAX_IMAGE + 1).read_to_end(&mut data).ok()?;
    if data.len() as u64 > MAX_IMAGE {
        return None;
    }
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join(format!("{name}.{ext}"));
    std::fs::write(&path, data).ok()?;
    Some(path)
}

/// Title, description, site name and image URL (as found) from the page head.
pub fn parse(html: &str) -> Preview {
    let mut meta: HashMap<String, String> = HashMap::new();
    let lower = html.to_ascii_lowercase();
    let mut pos = 0;
    while let Some(start) = lower[pos..].find("<meta") {
        let start = pos + start;
        let Some(end) = lower[start..].find('>') else { break };
        let tag = &html[start..start + end];
        let attrs = attributes(tag);
        let key = attrs.get("property").or_else(|| attrs.get("name")).map(|k| k.to_ascii_lowercase());
        if let (Some(key), Some(content)) = (key, attrs.get("content")) {
            meta.entry(key).or_insert_with(|| content.clone());
        }
        pos = start + end;
        if lower[..pos].contains("</head") {
            break;
        }
    }
    let title_tag = lower.find("<title").and_then(|s| {
        let open = s + lower[s..].find('>')? + 1;
        let close = open + lower[open..].find("</title")?;
        Some(html[open..close].to_string())
    });

    let pick = |keys: &[&str]| keys.iter().find_map(|k| meta.get(*k)).cloned().unwrap_or_default();
    let mut title = pick(&["og:title", "twitter:title"]);
    if title.is_empty() {
        title = title_tag.unwrap_or_default();
    }
    Preview {
        url: String::new(),
        title: clean(&title, 200),
        description: clean(&pick(&["og:description", "twitter:description", "description"]), 300),
        site_name: clean(&pick(&["og:site_name", "application-name"]), 80),
        image: decode_entities(pick(&["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"]).trim()),
    }
}

/// name="value" / name='value' / name=value attributes of a tag.
fn attributes(tag: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let chars: Vec<char> = tag.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        while i < chars.len() && !chars[i].is_alphanumeric() {
            i += 1;
        }
        let name_start = i;
        while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '-' || chars[i] == ':' || chars[i] == '_') {
            i += 1;
        }
        let name: String = chars[name_start..i].iter().collect::<String>().to_ascii_lowercase();
        while i < chars.len() && chars[i] == ' ' {
            i += 1;
        }
        if i < chars.len() && chars[i] == '=' {
            i += 1;
            while i < chars.len() && chars[i] == ' ' {
                i += 1;
            }
            let value: String = if i < chars.len() && (chars[i] == '"' || chars[i] == '\'') {
                let quote = chars[i];
                i += 1;
                let s = i;
                while i < chars.len() && chars[i] != quote {
                    i += 1;
                }
                let v = chars[s..i.min(chars.len())].iter().collect();
                i += 1;
                v
            } else {
                let s = i;
                while i < chars.len() && !chars[i].is_whitespace() && chars[i] != '/' {
                    i += 1;
                }
                chars[s..i].iter().collect()
            };
            if !name.is_empty() {
                out.entry(name).or_insert(value);
            }
        } else if name_start == i {
            i += 1;
        }
    }
    out
}

fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        rest = &rest[amp..];
        let Some(semi) = rest[..rest.len().min(12)].find(';') else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let entity = &rest[1..semi];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" | "#39" => Some('\''),
            "nbsp" => Some(' '),
            _ if entity.starts_with("#x") || entity.starts_with("#X") => {
                u32::from_str_radix(&entity[2..], 16).ok().and_then(char::from_u32)
            }
            _ if entity.starts_with('#') => entity[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match decoded {
            Some(c) => {
                out.push(c);
                rest = &rest[semi + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Entities decoded, whitespace collapsed, cut to `max` characters.
fn clean(s: &str, max: usize) -> String {
    let text = decode_entities(s).split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() > max {
        let cut: String = text.chars().take(max - 1).collect();
        format!("{}…", cut.trim_end())
    } else {
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_open_graph() {
        let html = r#"<html><head><title>Fallback</title>
            <meta property="og:title" content="Braids &amp; more">
            <meta name='description' content='A messenger'>
            <meta content="https://example.com/a.png" property="og:image" />
            <meta property="og:site_name" content="Example"></head><body>x</body></html>"#;
        let p = parse(html);
        assert_eq!(p.title, "Braids & more");
        assert_eq!(p.description, "A messenger");
        assert_eq!(p.image, "https://example.com/a.png");
        assert_eq!(p.site_name, "Example");
    }

    #[test]
    fn falls_back_to_title() {
        let p = parse("<head><title>\n  Just a  title </title></head>");
        assert_eq!(p.title, "Just a title");
    }

    #[test]
    fn local_addresses_are_not_fetched() {
        assert!(public_url("http://127.0.0.1/").is_none());
        assert!(public_url("http://localhost:8008/").is_none());
        assert!(public_url("http://192.168.1.1/").is_none());
        assert!(public_url("http://[::1]/").is_none());
        assert!(public_url("file:///etc/passwd").is_none());
    }
}
