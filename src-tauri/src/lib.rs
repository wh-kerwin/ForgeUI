#![recursion_limit = "256"]

mod app;
mod domain;
mod repositories;
mod services;

pub fn run() {
    app::run();
}
