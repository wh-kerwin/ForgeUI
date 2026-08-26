#![recursion_limit = "256"]

mod app;
pub mod conformance;
mod domain;
mod repositories;
mod services;

pub fn run() {
    app::run();
}
