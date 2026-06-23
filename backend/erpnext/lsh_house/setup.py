from setuptools import setup, find_packages

setup(
    name="lsh_house",
    version="1.0.0",
    description="L&S House ERPNext DocTypes — single source of truth for the LSH app",
    author="L&S Custom Tailors",
    packages=find_packages(),
    zip_safe=False,
    include_package_data=True,
)
